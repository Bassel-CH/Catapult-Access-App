"""
Service for rendering the printable per-person access review document.

Takes the structured review data from CSVService.build_review() plus the
audit metadata (label, manager, flagged permissions) and produces a single
styled HTML page. Open it in a browser and Ctrl+P -> Save as PDF.

One document, all selected people, a page break between each.
"""
from html import escape
from typing import List, Dict, Any, Set
from datetime import datetime


class DocumentService:
    """Renders review data into a printable HTML document."""

    @staticmethod
    def build_document(
        reviews: List[Dict[str, Any]],
        audit_label: str,
        manager_name: str,
        flagged: List[str],
    ) -> str:
        """
        Build the full HTML page.

        Args:
            reviews: list of per-person review objects from build_review()
            audit_label: e.g. "July - Operations"
            manager_name: manager the packet is for
            flagged: permissions to highlight. Each entry matches either a
                bare permission name ("Manage Scheduler Admin") or a
                domain-qualified name ("Staff Admin::Read Permissions").

        Returns:
            A complete HTML document as a string.
        """
        flagged_set: Set[str] = set(flagged or [])
        today = datetime.now().strftime("%B %d, %Y")

        people_html = "".join(
            DocumentService._render_person(r, flagged_set) for r in reviews
        )

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{escape(audit_label)} - Access Review</title>
<style>
{DocumentService._styles()}
</style>
</head>
<body>
<button class="no-print print-btn" onclick="window.print()">Print / Save as PDF</button>
<div class="doc-header">
  <h1>Access Review</h1>
  <p class="meta">{escape(audit_label)}</p>
  <p class="meta">Manager: {escape(manager_name) or "________________"}</p>
  <p class="meta">Generated: {today}</p>
</div>
{people_html}
</body>
</html>"""

    @staticmethod
    def _render_person(review: Dict[str, Any], flagged: Set[str]) -> str:
        """Render one person's section."""
        name = escape(review["staff_name"])

        if not review["found"]:
            return f"""<section class="person">
  <div class="person-header">
    <h2>{name}</h2>
    <p class="notfound">Not found in the uploaded report.</p>
  </div>
</section>"""

        email = escape(review["email"])
        direct_count = review["direct_count"]
        inherited_count = review["inherited_count"]

        direct_html = DocumentService._render_direct(review["direct"], flagged)
        inherited_html = DocumentService._render_inherited(review["inherited"])

        return f"""<section class="person">
  <div class="person-header">
    <h2>{name}</h2>
    <p class="sub">{email} &middot; {direct_count} direct &middot; {inherited_count} position-based</p>
  </div>

  <h3 class="section-title direct-title">Direct assignments &mdash; review each</h3>
  {direct_html}

  <div class="notes">
    <p class="notes-label">Manager notes &amp; decisions</p>
    <div class="notes-box"></div>
  </div>

  <h3 class="section-title ref-title">Position-based access (reference)</h3>
  {inherited_html}
</section>"""

    @staticmethod
    def _render_direct(groups: List[Dict[str, Any]], flagged: Set[str]) -> str:
        """Render the direct-assignment tables, grouped by domain."""
        if not groups:
            return '<p class="empty">No direct assignments.</p>'

        blocks = []
        for group in groups:
            domain = escape(group["domain"])
            rows = []
            for perm in group["permissions"]:
                is_flagged = (
                    perm in flagged
                    or f"{group['domain']}::{perm}" in flagged
                )
                row_class = "row flagged" if is_flagged else "row"
                flag_icon = '<span class="flag">&#9873;</span>' if is_flagged else ""
                rows.append(f"""<tr class="{row_class}">
      <td class="perm">{flag_icon}{escape(perm)}</td>
      <td class="box-cell"><span class="box"></span></td>
      <td class="box-cell"><span class="box"></span></td>
    </tr>""")

            blocks.append(f"""<table class="perm-table">
    <thead>
      <tr><th class="domain-th">{domain}</th><th class="hdr">Keep</th><th class="hdr">Revoke</th></tr>
    </thead>
    <tbody>
      {"".join(rows)}
    </tbody>
  </table>""")

        return "".join(blocks)

    @staticmethod
    def _render_inherited(positions: List[Dict[str, Any]]) -> str:
        """Render position-based access as compact reference, by position."""
        if not positions:
            return '<p class="empty">No position-based access.</p>'

        blocks = []
        for pos in positions:
            position = escape(pos["position"])
            lines = []
            for domain_group in pos["domains"]:
                domain = escape(domain_group["domain"])
                perms = ", ".join(escape(p) for p in domain_group["permissions"])
                lines.append(f'<p class="ref-line"><span class="ref-domain">{domain}:</span> {perms}</p>')
            blocks.append(f"""<div class="ref-position">
    <p class="ref-position-name">{position} ({pos["count"]})</p>
    {"".join(lines)}
  </div>""")

        return "".join(blocks)

    @staticmethod
    def _styles() -> str:
        """All CSS, including print rules, kept in one place."""
        return """
* { box-sizing: border-box; }
body {
  font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 24px;
  font-size: 13px; line-height: 1.45;
}
h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
h2 { font-size: 17px; font-weight: 600; margin: 0; }
h3 { font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
.doc-header { border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 24px; }
.doc-header .meta { margin: 2px 0; color: #555; font-size: 12px; }
.person-header { border-bottom: 1px solid #ccc; padding-bottom: 8px; margin-bottom: 4px; }
.person-header .sub { margin: 4px 0 0; color: #666; font-size: 12px; }
.direct-title { color: #b3261e; }
.ref-title { color: #555; }
.notfound { color: #999; font-style: italic; margin: 6px 0 0; }
.empty { color: #999; font-style: italic; font-size: 12px; }

.perm-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
.perm-table th { font-size: 11px; font-weight: 600; text-align: left; padding: 4px 6px; border-bottom: 1px solid #999; }
.perm-table .domain-th { color: #333; }
.perm-table .hdr { width: 56px; text-align: center; color: #666; }
.perm-table td { padding: 5px 6px; border-bottom: 1px solid #eee; }
.perm-table .perm { font-size: 12.5px; }
.box-cell { text-align: center; }
.box { display: inline-block; width: 13px; height: 13px; border: 1px solid #666; border-radius: 2px; vertical-align: middle; }
.row.flagged { background: #fdf0d5; }
.flag { color: #b3261e; margin-right: 5px; }

.notes { margin: 16px 0; }
.notes-label { font-size: 11px; color: #666; margin: 0 0 4px; }
.notes-box { border: 1px solid #999; border-radius: 4px; height: 90px; }

.ref-position { margin-bottom: 8px; }
.ref-position-name { font-size: 12px; font-weight: 600; margin: 6px 0 2px; }
.ref-line { font-size: 11.5px; color: #444; margin: 1px 0; }
.ref-domain { font-weight: 600; color: #333; }

.print-btn {
  position: fixed; top: 16px; right: 16px; padding: 8px 14px;
  font-size: 13px; border: 1px solid #333; background: #fff;
  border-radius: 6px; cursor: pointer;
}

@media print {
  body { padding: 0; }
  .no-print { display: none; }
  .person { page-break-before: always; }
  .person:first-child { page-break-before: avoid; }
  .row.flagged { background: #fdf0d5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
"""