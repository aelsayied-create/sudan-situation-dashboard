import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_data as b  # noqa: E402


def test_month_range_crosses_years():
    assert b.month_range("2025-11", "2026-02") == ["2025-11", "2025-12", "2026-01", "2026-02"]


def test_round_geometry():
    g = {"type": "Point", "coordinates": [32.123456, 15.987654]}
    assert b._round(g)["coordinates"] == [32.123, 15.988]


def test_num_handles_blanks():
    assert b.num("") == 0.0 and b.num("12.5") == 12.5 and b.num(None, None) is None


def test_built_data_is_consistent():
    import json
    d = json.loads((b.OUT / "sudan.json").read_text())
    # locality IDPs add up to the state totals used on the map
    assert abs(sum(d["idp"]["adm2"].values()) - sum(d["idp"]["adm1"].values())) < 1
    # every locality belongs to a known state
    assert all(v["s"] in d["states"] for v in d["localities"].values())
    # IPC phases never exceed the analysed population
    for p, x in d["ipc"]["national"].items():
        assert sum(x.get(k, 0) for k in "12345") <= x["all"] * 1.01
