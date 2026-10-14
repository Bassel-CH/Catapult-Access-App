"""
CSV reading: encodings, Excel's byte-order mark, ids kept as text.

Synthetic data only. Run from backend/:  python -m tests.test_csv_reading
"""
import asyncio

from app.services.csv_service import CSVService

HEADER = "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
ROWS = (
    "00123,Jené Butler,j@x.com,EHR,Access,NULL,Direct Assignment\n"
    "00456,Ana Muñoz,a@x.com,EHR,Access,Team Lead,Position-Based\n"
)


def _load(raw: bytes) -> CSVService:
    svc = CSVService()
    asyncio.run(svc.process_upload(raw, "t.csv"))
    return svc


def _names(svc):
    return sorted(svc.current_df["StaffName"])


def test_cp1252_file_reads_accents_correctly():
    # The monthly export's format.
    assert _names(_load((HEADER + ROWS).encode("cp1252"))) == ["Ana Muñoz", "Jené Butler"]


def test_utf8_file_reads_accents_correctly():
    # Used to come out as "JenÃ© Butler".
    assert _names(_load((HEADER + ROWS).encode("utf-8"))) == ["Ana Muñoz", "Jené Butler"]


def test_excel_csv_utf8_with_bom_is_accepted():
    # Excel "CSV UTF-8" starts with an invisible byte-order mark.
    # Used to fail with "Missing required columns: StaffId".
    svc = _load(("﻿" + HEADER + ROWS).encode("utf-8"))
    assert _names(svc) == ["Ana Muñoz", "Jené Butler"]


def test_staff_ids_keep_leading_zeros():
    svc = _load((HEADER + ROWS).encode("cp1252"))
    assert sorted(svc.current_df["StaffId"]) == ["00123", "00456"]


def test_null_position_text_still_reads_as_blank():
    # The real export writes the text NULL for direct assignments' position;
    # the app relies on that becoming blank.
    svc = _load((HEADER + ROWS).encode("cp1252"))
    direct = svc.current_df[svc.current_df["PermissionSource"] == "Direct Assignment"]
    assert list(direct["PositionName"]) == [""]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ALL CHECKS PASSED")
