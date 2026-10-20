"""
Search text is matched literally (not as a regex pattern).

Synthetic data only. Run from backend/:  python -m tests.test_search
"""
import asyncio

from app.services.uploaded_dataset import UploadedDataset

CSV = (
    "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
    "1,Amber Weiss,a@x.com,EHR,Read (Limited),,Direct Assignment\n"
    "2,Brian Wishard,b@x.com,EHR,abc,,Direct Assignment\n"
)


def _search(text):
    svc = UploadedDataset()
    asyncio.run(svc.process_upload(CSV.encode(), "t.csv"))
    return [r["PermissionName"] for r in svc.apply_filters({"search_text": text})["data"]]


def test_parenthesis_is_searchable():
    # Used to crash: "missing ), unterminated subpattern".
    assert _search("(") == ["Read (Limited)"]
    assert _search("(limited)") == ["Read (Limited)"]


def test_dot_is_literal_not_wildcard():
    # As a regex, "a.c" would match "abc".
    assert _search("a.c") == []


def test_plain_search_still_case_insensitive():
    assert _search("WISHARD") == ["abc"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ALL CHECKS PASSED")
