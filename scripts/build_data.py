"""
Build web-ready data for the Sudan Situation Dashboard (offline, no network).

Reads the raw files in data/raw/ (refreshed weekly by fetch_data.py) and writes
web/data/sudan.json plus simplified state / locality GeoJSON.

Every figure in the dashboard is computed here from the source files, so the
front end never hard-codes a number.
"""
import csv
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "data"
WAR_START = "2023-04"
DRY_MM = 5             # long-term monthly average below this = dry season
COUNTRY = {"TCD": "Chad", "EGY": "Egypt", "SSD": "South Sudan", "LBY": "Libya", "ETH": "Ethiopia", "UGA": "Uganda",
           "CAF": "Central African Rep.", "KEN": "Kenya", "SAU": "Saudi Arabia", "FRA": "France", "GBR": "United Kingdom",
           "ERI": "Eritrea", "YEM": "Yemen", "JOR": "Jordan", "USA": "United States", "DEU": "Germany", "ISR": "Israel",
           "NLD": "Netherlands", "TUN": "Tunisia", "IRL": "Ireland", "BEL": "Belgium", "CAN": "Canada", "AUS": "Australia",
           "ITA": "Italy", "SWE": "Sweden", "NOR": "Norway", "CHE": "Switzerland", "AUT": "Austria", "TUR": "Türkiye",
           "SSD ": "South Sudan", "COD": "DR Congo", "SOM": "Somalia", "DJI": "Djibouti", "NER": "Niger", "MAR": "Morocco"}
RET_SAMPLE_COMMODITIES = ["Sorghum", "Millet", "Wheat flour", "Oil (vegetable)", "Sugar", "Onions", "Beans (fava, egyptian)", "Meat (goat)"]


def rows(name):
    p = RAW / name
    if not p.exists():
        print("  missing", name)
        return []
    with p.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def ym(d):
    return d[:7]


def month_range(a, b):
    y, m = int(a[:4]), int(a[5:7])
    out = []
    while f"{y}-{m:02d}" <= b:
        out.append(f"{y}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


# ------------------------------------------------------------------ geography
def geography():
    adm1 = json.loads((RAW / "sdn_admin1.geojson").read_text())
    adm2 = json.loads((RAW / "sdn_admin2.geojson").read_text())
    pop1 = {r["ADM1_PCODE"]: r for r in rows("pop_adm1.csv")}
    pop2 = {r["ADM2_PCODE"]: r for r in rows("pop_adm2.csv")}
    states = {f["properties"]["pcode"]: {"n": f["properties"]["name"], "ar": f["properties"]["name_ar"],
                                         "pop": int(num(pop1.get(f["properties"]["pcode"], {}).get("T_TL")))} for f in adm1["features"]}
    locs = {f["properties"]["pcode"]: {"n": f["properties"]["name"], "ar": f["properties"]["name_ar"], "s": f["properties"]["adm1"],
                                       "pop": int(num(pop2.get(f["properties"]["pcode"], {}).get("T_TL")))} for f in adm2["features"]}
    year = next(iter(pop1.values()), {}).get("Year")
    for fc, name in ((adm1, "states"), (adm2, "localities")):
        for f in fc["features"]:
            f["properties"] = {"pcode": f["properties"]["pcode"]}
            f["geometry"] = _round(f["geometry"])
        (OUT / f"{name}.geojson").write_text(json.dumps(fc, separators=(",", ":")))
    return states, locs, year


def _round(g, nd=3):
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


# ------------------------------------------------------------------ displacement
def displacement(states, locs):
    rs = [r for r in rows("hapi_idps.csv") if r["operation"] == "Armed Clashes in Sudan (Overview)"]
    nat = sorted({(r["reference_period_end"], int(num(r["population"]))) for r in rs if r["admin_level"] == "0"})
    latest = max(r["reference_period_end"] for r in rs if r["admin_level"] == "2")
    a1 = defaultdict(int)
    a2 = defaultdict(int)
    s1 = defaultdict(dict)
    for r in rs:
        p = int(num(r["population"]))
        if r["admin_level"] == "1":
            s1[r["admin1_code"]][r["reference_period_end"]] = p
        if r["reference_period_end"] != latest:
            continue
        if r["admin_level"] == "2":
            a2[r["admin2_code"]] += p
            a1[r["admin1_code"]] += p
    dates = sorted({d for v in s1.values() for d in v})
    # origin -> destination matrix from the latest DTM snapshot (state level)
    od, ret1, ret2, ret_od = {}, {}, {}, {}
    names = {v["n"].lower(): k for k, v in states.items()}
    names.update({"abyei": "SD19", "abyei pca": "SD19"})
    for r in rows("dtm_idps_adm1.csv"):
        dest = r.get("State Code")
        if dest:
            od[dest] = {names.get(k.strip().lower()): int(num(v)) for k, v in r.items()
                        if k.strip().lower() in names and num(v) > 0}
    for r in rows("dtm_returnees_adm1.csv"):
        dest = r.get("State Code")
        if dest:
            ret1[dest] = int(num(r.get("INDs")))
            ret_od[dest] = {names.get(k.strip().lower()): int(num(v)) for k, v in r.items()
                            if k.strip().lower() in names and num(v) > 0}
    for r in rows("dtm_returnees_adm2.csv"):
        if r.get("Locality Code"):
            ret2[r["Locality Code"]] = int(num(r.get("INDs")))
    meta = json.loads((RAW / "dtm_meta.json").read_text()) if (RAW / "dtm_meta.json").exists() else {}
    origin = defaultdict(int)
    for d in od.values():
        for o, n in d.items():
            origin[o] += n
    return {
        "date": latest, "national": nat, "adm1": dict(a1), "adm2": dict(a2),
        "series": {"dates": dates, "adm1": {k: [v.get(d) for d in dates] for k, v in s1.items()}},
        "origin": dict(origin), "od": od,
        "returnees": {"adm1": ret1, "adm2": ret2, "od": ret_od, "total": sum(ret1.values())},
        "dtm": {k: v.split(":")[-1].replace("Master List", "").strip() for k, v in meta.items()},
    }


# ------------------------------------------------------------------ conflict (ACLED aggregates via HAPI)
def conflict():
    rs = rows("hapi_conflict.csv")
    if not rs:
        # ACLED data is not redistributed in this repo (see README). Without the raw file
        # (e.g. on a plain checkout), keep the aggregates from the last published build.
        prev = OUT / "sudan.json"
        if prev.exists():
            print("  conflict: raw ACLED file absent, reusing last published aggregates")
            return json.loads(prev.read_text())["conflict"]
        raise SystemExit("hapi_conflict.csv missing: run scripts/fetch_data.py first")
    last_full = max(ym(r["reference_period_start"]) for r in rs)
    # drop the current, incomplete month
    today = date.today().strftime("%Y-%m")
    if last_full >= today:
        last_full = sorted({ym(r["reference_period_start"]) for r in rs})[-2]
    months = month_range("2023-01", last_full)
    mi = {m: i for i, m in enumerate(months)}
    types = ["political_violence", "civilian_targeting", "demonstration"]
    nat = {t: [0] * len(months) for t in types}
    fat = [0] * len(months)
    a1e = defaultdict(lambda: [0] * len(months))
    a1f = defaultdict(lambda: [0] * len(months))
    a2 = defaultdict(lambda: {"e12": 0, "f12": 0, "ew": 0, "fw": 0})
    last12 = set(months[-12:])
    for r in rs:
        m = ym(r["reference_period_start"])
        if m not in mi:
            continue
        e, f = int(num(r["events"])), int(num(r["fatalities"]))
        t = r["event_type"]
        # political violence already includes civilian targeting in ACLED's HRP aggregates;
        # count fatalities only from political violence to avoid double counting
        nat[t][mi[m]] += e
        if t == "political_violence":
            fat[mi[m]] += f
            a1e[r["admin1_code"]][mi[m]] += e
            a1f[r["admin1_code"]][mi[m]] += f
            x = a2[r["admin2_code"]]
            if m in last12:
                x["e12"] += e
                x["f12"] += f
            if m >= WAR_START:
                x["ew"] += e
                x["fw"] += f
    return {"months": months, "national": nat, "fatalities": fat, "adm1": {"e": dict(a1e), "f": dict(a1f)}, "adm2": dict(a2)}


# ------------------------------------------------------------------ food security (IPC via HAPI)
def ipc():
    rs = rows("hapi_ipc.csv")
    out = {"periods": [], "national": {}, "adm1": defaultdict(dict), "adm2": defaultdict(dict)}
    cur = max(r["reference_period_start"] for r in rs if r["ipc_type"] == "current")
    picks = [("current", cur)]
    proj = sorted({r["reference_period_start"] for r in rs if r["ipc_type"] == "first projection" and r["reference_period_start"] > cur})
    if proj:
        picks.append(("first projection", proj[0]))
    for typ, start in picks:
        sel = [r for r in rs if r["ipc_type"] == typ and r["reference_period_start"] == start]
        key = f"{typ}|{start}"
        end = sel[0]["reference_period_end"]
        out["periods"].append({"key": key, "type": typ, "start": start, "end": end})
        for r in sel:
            p, ph = int(num(r["population_in_phase"])), r["ipc_phase"]
            lvl = r["admin_level"]
            if lvl == "0":
                out["national"].setdefault(key, {})[ph] = out["national"].get(key, {}).get(ph, 0) + p
            elif lvl in ("1", "2"):
                code = r["admin1_code"] if lvl == "1" else r["admin2_code"]
                d = out[f"adm{lvl}"][code].setdefault(key, {})
                d[ph] = d.get(ph, 0) + p
    out["adm1"], out["adm2"] = dict(out["adm1"]), dict(out["adm2"])
    return out


# ------------------------------------------------------------------ markets (WFP)
def prices():
    rs = [r for r in rows("wfp_prices.csv") if r["pricetype"] == "Retail" and r["priceflag"] in ("actual", "aggregate")]
    months = sorted({ym(r["date"]) for r in rs})
    comms = [c for c in RET_SAMPLE_COMMODITIES if any(r["commodity"] == c for r in rs)]
    unit = {}
    by = defaultdict(lambda: defaultdict(list))
    byusd = defaultdict(lambda: defaultdict(list))
    mk = {}
    mkp = defaultdict(lambda: defaultdict(dict))
    for r in rs:
        c = r["commodity"]
        if c not in comms:
            continue
        unit.setdefault(c, r["unit"])
        if r["unit"] != unit[c]:
            continue
        m = ym(r["date"])
        by[c][m].append(num(r["price"]))
        if num(r["usdprice"]) > 0:
            byusd[c][m].append(num(r["usdprice"]))
        mk[r["market_id"]] = {"n": r["market"], "s": r["admin1"], "lat": num(r["latitude"]), "lon": num(r["longitude"])}
        mkp[r["market_id"]][c][m] = num(r["price"])
    nat = {c: [round(median(by[c][m])) if by[c][m] else None for m in months] for c in comms}
    usd = {c: [round(median(byusd[c][m]), 3) if byusd[c][m] else None for m in months] for c in comms}
    markets = []
    for mid, info in mk.items():
        p = {}
        for c in comms:
            ser = mkp[mid].get(c, {})
            if not ser:
                continue
            lm = max(ser)
            y0 = f"{int(lm[:4]) - 1}{lm[4:]}"
            p[c] = {"m": lm, "p": ser[lm], "y": ser.get(y0), "stale": lm < months[-6]}
        markets.append({**info, "id": mid, "p": p})
    return {"months": months, "commodities": comms, "unit": unit, "national": nat, "usd": usd, "markets": markets}


# ------------------------------------------------------------------ response
def response():
    pres = rows("hapi_presence.csv")
    sectors = sorted({r["sector_name"] for r in pres})
    a1 = defaultdict(lambda: defaultdict(set))
    a2 = defaultdict(lambda: defaultdict(set))
    orgs_type = defaultdict(set)
    for r in pres:
        a1[r["admin1_code"]][r["sector_name"]].add(r["org_acronym"])
        a1[r["admin1_code"]]["*"].add(r["org_acronym"])
        a2[r["admin2_code"]][r["sector_name"]].add(r["org_acronym"])
        a2[r["admin2_code"]]["*"].add(r["org_acronym"])
        orgs_type[r["org_type_description"]].add(r["org_acronym"])
    period = (pres[0]["reference_period_start"], pres[0]["reference_period_end"]) if pres else ("", "")
    nat_sector = {s: len({r["org_acronym"] for r in pres if r["sector_name"] == s}) for s in sectors}
    fund = []
    for r in rows("hapi_funding.csv"):
        if num(r["requirements_usd"]) > 0:
            fund.append({"y": r["reference_period_start"][:4], "name": r["appeal_name"], "req": num(r["requirements_usd"]),
                         "fund": num(r["funding_usd"]), "pct": num(r["funding_pct"])})
    # one main appeal per year (largest requirement), since 2014
    main = {}
    for f in fund:
        if f["y"] >= "2014" and (f["y"] not in main or f["req"] > main[f["y"]]["req"]):
            main[f["y"]] = f
    fund = [main[y] for y in sorted(main)]
    needs = {r["population_status"]: int(num(r["population"])) for r in rows("hapi_needs.csv") if r["admin_level"] == "0" and r["sector_code"] == "Intersectoral"}
    needs_year = next((r["reference_period_start"][:4] for r in rows("hapi_needs.csv") if r["admin_level"] == "0"), "")
    pin2, pin_year = defaultdict(int), ""
    for r in rows("hapi_needs.csv"):
        if r["admin_level"] == "2" and r["sector_code"] == "Intersectoral" and r["population_status"] == "INN" and r["category"] == "total":
            pin2[r["admin2_code"]] += int(num(r["population"]))
            pin_year = r["reference_period_start"][:4]
    pin1 = defaultdict(int)
    for r in rows("hapi_needs.csv"):
        if r["admin_level"] == "2" and r["sector_code"] == "Intersectoral" and r["population_status"] == "INN" and r["category"] == "total":
            pin1[r["admin1_code"]] += int(num(r["population"]))
    return {
        "period": period, "sectors": sectors, "national": nat_sector,
        "orgs": len({r["org_acronym"] for r in pres}), "org_types": {k: len(v) for k, v in orgs_type.items()},
        "adm1": {k: {s: len(v) for s, v in d.items()} for k, d in a1.items()},
        "adm2": {k: {s: len(v) for s, v in d.items()} for k, d in a2.items()},
        "funding": fund, "needs": {**needs, "year": needs_year},
        "pin": {"year": pin_year, "adm1": dict(pin1), "adm2": dict(pin2)},
    }


# ------------------------------------------------------------------ climate (CHIRPS-based rainfall via HAPI)
def rainfall():
    rs = [r for r in rows("hapi_rainfall.csv") if r["aggregation_period"] == "1-month"]
    # keep the value for each calendar month at its last dekad (rolling 1-month window ending on the month end)
    best = {}
    for r in rs:
        end = r["reference_period_end"]
        if int(end[8:10]) < 28:
            continue
        code = r["admin1_code"] if r["admin_level"] == "1" else r["admin2_code"]
        k = (r["admin_level"], code, end[:7])
        if k not in best or r["version"] == "final":
            best[k] = r
    months = sorted({k[2] for k in best})[-24:]
    out = {"months": months, "adm1": defaultdict(lambda: [None] * len(months)), "adm2": defaultdict(lambda: [None] * len(months)),
           "mm1": defaultdict(lambda: [None] * len(months)), "lta1": defaultdict(lambda: [None] * len(months))}
    mi = {m: i for i, m in enumerate(months)}
    for (lvl, code, m), r in best.items():
        if m not in mi:
            continue
        a = num(r["rainfall_anomaly_pct"], None)
        if num(r["rainfall_long_term_average"]) < DRY_MM:   # dry season: % of a tiny average is meaningless
            a = None
        out[f"adm{lvl}"][code][mi[m]] = round(a, 1) if a is not None else None
        if lvl == "1":
            out["mm1"][code][mi[m]] = round(num(r["rainfall"]), 1)
            out["lta1"][code][mi[m]] = round(num(r["rainfall_long_term_average"]), 1)
    return {k: (dict(v) if isinstance(v, defaultdict) else v) for k, v in out.items()}


# ------------------------------------------------------------------ refugees from Sudan (UNHCR via HAPI)
def refugees():
    rs = [r for r in rows("hapi_refugees.csv") if r["gender"] == "all" and r["age_range"] == "all"]
    years = sorted({r["reference_period_start"][:4] for r in rs})
    out_by = defaultdict(lambda: [0] * len(years))
    inside = [0] * len(years)
    for r in rs:
        i = years.index(r["reference_period_start"][:4])
        if r["origin_location_code"] == "SDN" and r["population_group"] in ("REF", "ASY"):
            out_by[r["asylum_location_code"]][i] += int(num(r["population"]))
        elif r["asylum_location_code"] == "SDN" and r["population_group"] in ("REF", "ASY"):
            inside[i] += int(num(r["population"]))
    top = sorted(out_by, key=lambda k: -out_by[k][-1])[:8]
    other = [sum(out_by[k][i] for k in out_by if k not in top) for i in range(len(years))]
    return {"years": years, "countries": {k: {"n": COUNTRY.get(k, k), "v": out_by[k]} for k in top},
            "other": other, "total": [sum(v[i] for v in out_by.values()) for i in range(len(years))], "hosted": inside}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    states, locs, pop_year = geography()
    src = json.loads((RAW / "SOURCES.json").read_text())
    risk = (rows("hapi_risk.csv") or [{}])[-1]
    data = {
        "meta": {"built": date.today().isoformat(), "fetched": src.get("_fetched"), "pop_year": pop_year,
                 "sources": {k: v for k, v in src.items() if not k.startswith("_")}},
        "states": states, "localities": locs,
        "idp": displacement(states, locs), "conflict": conflict(), "ipc": ipc(), "prices": prices(),
        "response": response(), "rain": rainfall(), "refugees": refugees(),
        "risk": {k: num(risk.get(k), None) for k in ("overall_risk", "hazard_exposure_risk", "vulnerability_risk", "coping_capacity_risk", "global_rank", "risk_class")},
    }
    (OUT / "sudan.json").write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    d = data
    print(f"OK: {len(states)} states, {len(locs)} localities | IDPs {d['idp']['national'][-1]} | "
          f"returnees {d['idp']['returnees']['total']:,} | conflict months {len(d['conflict']['months'])} | "
          f"IPC periods {[p['key'] for p in d['ipc']['periods']]} | markets {len(d['prices']['markets'])} | "
          f"orgs {d['response']['orgs']} | rain months {d['rain']['months'][0]}..{d['rain']['months'][-1]} | "
          f"refugees abroad {d['refugees']['total'][-1]:,}")


if __name__ == "__main__":
    main()
