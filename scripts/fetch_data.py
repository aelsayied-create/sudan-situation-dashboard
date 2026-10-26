"""
Fetch open humanitarian data for Sudan (runs in GitHub Actions, needs internet).

All sources are public on the Humanitarian Data Exchange (HDX), no API keys:
  * HDX HAPI (standardised): IDPs, refugees, returnees, humanitarian needs, operational
    presence (3W), funding, conflict events (ACLED aggregates), national risk (INFORM),
    food security (IPC), rainfall (CHIRPS-based, WFP)
  * OCHA COD-AB: state (admin-1) and locality (admin-2) boundaries
  * UNFPA COD-PS: population by state / locality (English + Arabic names)
  * IOM DTM: latest displacement & return snapshot (origin -> destination matrix)
  * WFP: market food prices

Raw, lightly filtered copies are written to data/raw/ and versioned; build_data.py
turns them into web-ready files without any network access.
"""
import csv
import gzip
import io
import json
import re
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
HDX = "https://data.humdata.org/api/3/action/package_show?id="
SINCE = "2023-01-01"          # the current war started on 15 April 2023


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "sudan-situation-dashboard", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=300) as r:
                b = r.read()
            return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print("  retry", url[:90], e)
            time.sleep(5 * (i + 1))


def package(pid):
    return json.loads(get(HDX + urllib.parse.quote(pid)))["result"]


def resource(pkg, pattern, fmt=None):
    """Most recently modified resource whose name matches the regex."""
    rs = [r for r in pkg["resources"] if re.search(pattern, r["name"], re.I)
          and (fmt is None or r["format"].upper() == fmt)]
    if not rs:
        raise LookupError(f"{pkg['name']}: no resource like {pattern!r}")
    return max(rs, key=lambda r: r.get("last_modified") or "")


def read_csv(b):
    return list(csv.DictReader(io.StringIO(b.decode("utf-8-sig", "replace"))))


def write_csv(name, rows, cols):
    with (RAW / name).open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  {name}: {len(rows)} rows")


SOURCES = {}


def note(key, pkg, res):
    SOURCES[key] = {"dataset": pkg["title"], "org": (pkg.get("organization") or {}).get("title"),
                    "resource": res["name"], "updated": (res.get("last_modified") or "")[:10],
                    "url": f"https://data.humdata.org/dataset/{pkg['name']}", "license": pkg.get("license_title")}


# ---------------------------------------------------------------- HDX HAPI
ADM = ["admin_level", "admin1_code", "admin1_name", "admin2_code", "admin2_name"]


def fetch_hapi():
    pkg = package("hdx-hapi-sdn")

    def hapi(key, pattern):
        r = resource(pkg, pattern, "CSV")
        note(key, pkg, r)
        return read_csv(get(r["url"]))

    rows = hapi("idps", r"Internally-Displaced")
    write_csv("hapi_idps.csv", rows, ADM + ["operation", "assessment_type", "population", "reporting_round", "reference_period_end"])

    rows = hapi("needs", r"Humanitarian Needs")
    latest = max(r["reference_period_start"] for r in rows)
    write_csv("hapi_needs.csv", [r for r in rows if r["reference_period_start"] == latest],
              ADM + ["sector_code", "sector_name", "category", "population_status", "population", "reference_period_start"])

    rows = hapi("presence", r"Operational Presence")
    write_csv("hapi_presence.csv", rows, ADM + ["org_acronym", "org_name", "org_type_description", "sector_code", "sector_name", "reference_period_start", "reference_period_end"])

    rows = hapi("funding", r"Funding")
    write_csv("hapi_funding.csv", rows, ["appeal_code", "appeal_name", "appeal_type", "requirements_usd", "funding_usd", "funding_pct", "reference_period_start", "reference_period_end"])

    rows = hapi("conflict", r"Conflict Events")
    write_csv("hapi_conflict.csv", [r for r in rows if r["reference_period_start"] >= SINCE and r["admin_level"] in ("1", "2")],
              ADM + ["event_type", "events", "fatalities", "reference_period_start"])

    rows = hapi("risk", r"National Risk")
    write_csv("hapi_risk.csv", rows, ["risk_class", "global_rank", "overall_risk", "hazard_exposure_risk", "vulnerability_risk", "coping_capacity_risk", "reference_period_start"])

    rows = hapi("ipc", r"Food Security for")
    write_csv("hapi_ipc.csv", [r for r in rows if r["reference_period_start"] >= SINCE],
              ADM + ["ipc_phase", "ipc_type", "population_in_phase", "population_fraction_in_phase", "reference_period_start", "reference_period_end"])

    rows = hapi("rainfall", r"Rainfall")
    write_csv("hapi_rainfall.csv", [r for r in rows if r["aggregation_period"] in ("1-month", "3-month") and r["reference_period_start"] >= "2024-01-01"],
              ADM + ["aggregation_period", "rainfall", "rainfall_long_term_average", "rainfall_anomaly_pct", "version", "reference_period_start", "reference_period_end"])

    rows = hapi("refugees", r"Refugees")
    keep = [r for r in rows if (r["origin_location_code"] == "SDN") != (r["asylum_location_code"] == "SDN")
            and r["reference_period_start"] >= "2018-01-01"]
    write_csv("hapi_refugees.csv", keep, ["origin_location_code", "asylum_location_code", "population_group", "gender", "age_range", "population", "reference_period_start"])


# ---------------------------------------------------------------- boundaries + population
def fetch_boundaries():
    from shapely.geometry import mapping, shape
    pkg = package("cod-ab-sdn")
    r = resource(pkg, r"geojson", None)
    note("boundaries", pkg, r)
    z = zipfile.ZipFile(io.BytesIO(get(r["url"])))
    for lvl, tol in (("admin1", 0.004), ("admin2", 0.004)):
        name = next(n for n in z.namelist() if n.endswith(f"{lvl}.geojson"))
        gj = json.loads(z.read(name))
        feats = []
        for f in gj["features"]:
            p = f["properties"]
            n = lvl[-1]
            feats.append({"type": "Feature", "properties": {
                "pcode": p.get(f"adm{n}_pcode") or p.get(f"ADM{n}_PCODE"),
                "name": p.get(f"adm{n}_name") or p.get(f"ADM{n}_EN") or p.get(f"adm{n}_name1"),
                "name_ar": p.get(f"adm{n}_name1") or p.get(f"ADM{n}_AR") or "",
                "adm1": p.get("adm1_pcode") or p.get("ADM1_PCODE")},
                "geometry": mapping(shape(f["geometry"]).simplify(tol, preserve_topology=True))})
        print(f"  {lvl}: {len(feats)} features; props sample {list(gj['features'][0]['properties'])[:12]}")
        (RAW / f"sdn_{lvl}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))


def fetch_population():
    pkg = package("cod-ps-sdn")
    for lvl in ("adm1", "adm2"):
        r = resource(pkg, rf"admpop_{lvl}", "CSV")
        note(f"population_{lvl}", pkg, r)
        rows = read_csv(get(r["url"]))
        cols = [c for c in rows[0] if c in ("Year", "ADM1_EN", "ADM1_AR", "ADM1_PCODE", "ADM2_EN", "ADM2_AR", "ADM2_PCODE", "F_TL", "M_TL", "T_TL")]
        write_csv(f"pop_{lvl}.csv", rows, cols)


# ---------------------------------------------------------------- IOM DTM snapshot
def _sheet_table(ws):
    """Rows after the HXL hashtag row, keyed by the header row above it."""
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    title = next((str(r[0]) for r in rows if r and r[0]), "")
    for i, r in enumerate(rows):
        if any(isinstance(c, str) and c.startswith("#") for c in r):
            head = [str(h).strip() if h is not None else f"col{j}" for j, h in enumerate(rows[i - 1])]
            data = [dict(zip(head, x)) for x in rows[i + 1:] if x and x[1]]
            return title, head, data
    raise ValueError(f"no HXL row in {ws.title}")


def fetch_dtm():
    import openpyxl
    pkg = package("sudan-displacement-situation-countrywide-idps-iom-dtm")
    r = resource(pkg, r"Snapshot", "XLSX")
    note("dtm", pkg, r)
    wb = openpyxl.load_workbook(io.BytesIO(get(r["url"])), read_only=True, data_only=True)
    meta = {}
    for ws in wb.worksheets:
        t = ws.title.lower()
        kind = "idps" if "idp" in t else "returnees" if "return" in t else None
        lvl = "adm1" if "admin1" in t.replace(" ", "") else "adm2" if "admin2" in t.replace(" ", "") else None
        if not kind or not lvl:
            continue
        title, head, data = _sheet_table(ws)
        meta[f"{kind}_{lvl}"] = title
        with (RAW / f"dtm_{kind}_{lvl}.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(head)
            for d in data:
                w.writerow([d.get(h) for h in head])
        print(f"  dtm_{kind}_{lvl}: {len(data)} rows · {title}")
    (RAW / "dtm_meta.json").write_text(json.dumps(meta, indent=1))


# ---------------------------------------------------------------- WFP prices
def fetch_prices():
    pkg = package("wfp-food-prices-for-sudan")
    r = resource(pkg, r"Food Prices", "CSV")
    note("prices", pkg, r)
    rows = [x for x in read_csv(get(r["url"])) if x["date"] >= "2019-01-01" and not x["date"].startswith("#")]
    write_csv("wfp_prices.csv", rows, ["date", "admin1", "admin2", "market", "market_id", "latitude", "longitude",
                                       "category", "commodity", "unit", "priceflag", "pricetype", "currency", "price", "usdprice"])


if __name__ == "__main__":
    RAW.mkdir(parents=True, exist_ok=True)
    steps = [("HAPI", fetch_hapi), ("boundaries", fetch_boundaries), ("population", fetch_population),
             ("DTM", fetch_dtm), ("prices", fetch_prices)]
    failed = []
    for name, fn in steps:
        print(name)
        try:
            fn()
        except Exception as e:  # noqa: BLE001  keep the previous raw file if one source fails
            print(f"  FAILED: {e!r}")
            failed.append(name)
    old = json.loads((RAW / "SOURCES.json").read_text()) if (RAW / "SOURCES.json").exists() else {}
    old.update(SOURCES)
    old["_fetched"] = date.today().isoformat()
    (RAW / "SOURCES.json").write_text(json.dumps(old, indent=1, ensure_ascii=False))
    if len(failed) == len(steps):
        raise SystemExit("all sources failed")
    print("failed:", failed or "none")
