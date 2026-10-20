"""
Service for producing the COMPLETED audit report.

Unlike DocumentService (which renders a blank printable form), this takes the
manager's captured Keep/Revoke decisions and highlights, applies the audit
rules on the server so the record is authoritative, and renders a read-only
report showing what was kept, revoked, or left undecided.

Two responsibilities, kept together on purpose:
  1. summarize(): the numbers (kept / revoked / no-decision) -- the audit fact.
  2. render(): the human-readable HTML report built from those same facts.

The Access-cascade rule lives here (not just in the UI) so the authoritative
report is always internally consistent: if an app's "Access" is revoked, the
rest of that app's permissions are treated as revoked too.
"""
from html import escape
from datetime import datetime
from typing import List, Dict, Any, Tuple


ACCESS_PERMISSION = "access"  # matched case-insensitively


class ReportService:
    """Turns an audit tree + decisions into counts and a completed report."""

    # ------------------------------------------------------------------
    # Core logic: effective decisions + counts
    # ------------------------------------------------------------------

    @staticmethod
    def _effective_decisions(
        people: List[Dict[str, Any]],
        decisions: Dict[str, Dict[str, Any]],
    ) -> Dict[str, str]:
        """
        Resolve the authoritative decision for every permission id.

        Starts from the manager's raw choices, then applies the Access-cascade:
        within one person + group + app, if "Access" is revoked, every other
        permission in that app is forced to 'revoke' as well.

        SCOPE (decision "Path A", guarded by parity/compare_backend_to_reference.py): the
        cascade stays within a single (person, group, app). Revoking a DIRECT
        grant's Access does NOT revoke access the person also holds to the same
        app via a POSITION — those are separate groups. This is a deliberate
        divergence from the original prototype's broader (person, app) sweep.

        Returns id -> 'keep' | 'revoke' | 'none'.
        """
        effective: Dict[str, str] = {}

        for person in people:
            for group in person.get("groups", []):
                for app in group.get("apps", []):
                    perms = app.get("permissions", [])

                    # Is this app's "Access" permission revoked?
                    access_revoked = any(
                        p["name"].strip().lower() == ACCESS_PERMISSION
                        and (decisions.get(p["id"], {}) or {}).get("decision") == "revoke"
                        for p in perms
                    )

                    for p in perms:
                        raw = (decisions.get(p["id"], {}) or {}).get("decision")
                        if access_revoked:
                            effective[p["id"]] = "revoke"
                        elif raw in ("keep", "revoke"):
                            effective[p["id"]] = raw
                        else:
                            effective[p["id"]] = "none"

        return effective

    @staticmethod
    def summarize(
        people: List[Dict[str, Any]],
        decisions: Dict[str, Dict[str, Any]],
    ) -> Dict[str, int]:
        """Headline counts across all permissions, after cascade."""
        effective = ReportService._effective_decisions(people, decisions)
        kept = sum(1 for v in effective.values() if v == "keep")
        revoked = sum(1 for v in effective.values() if v == "revoke")
        no_decision = sum(1 for v in effective.values() if v == "none")
        return {
            "users_reviewed": sum(1 for p in people if p.get("found")),
            "total_permissions": len(effective),
            "kept": kept,
            "revoked": revoked,
            "no_decision": no_decision,
        }

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

    @staticmethod
    def render(
        people: List[Dict[str, Any]],
        decisions: Dict[str, Dict[str, Any]],
        highlights: Dict[str, str],
        department: str,
        period_label: str,
        manager_name: str,
    ) -> Tuple[str, Dict[str, int]]:
        """
        Render the completed report. Returns (html, summary_counts).
        """
        effective = ReportService._effective_decisions(people, decisions)
        summary = ReportService.summarize(people, decisions)
        highlights = highlights or {}
        decisions = decisions or {}

        body = "".join(
            ReportService._render_person(p, effective, decisions, highlights)
            for p in people
        )
        generated = datetime.now().strftime("%B %d, %Y %I:%M %p")

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catapult Applications Audit &mdash; {escape(department)}</title>
<style>
{ReportService._styles()}
</style>
</head>
<body>
<div class="w">
  <h1>Catapult Applications Audit &mdash; {escape(department)}</h1>
  <p class="sub">Manager review &middot; generated {generated}</p>
  <span class="ro">Read-only report</span>

  <div class="ban">
    <div><div class="k">Department</div><div class="v">{escape(department) or "&mdash;"}</div></div>
    <div><div class="k">Period</div><div class="v">{escape(period_label) or "&mdash;"}</div></div>
    <div><div class="k">Manager</div><div class="v">{escape(manager_name) or "&mdash;"}</div></div>
    <div><div class="k">Users reviewed</div><div class="v">{summary['users_reviewed']}</div></div>
    <div><div class="k">Permissions</div><div class="v">{summary['total_permissions']}</div></div>
  </div>

  <div class="sum">
    <div class="sc"><div class="n keep">{summary['kept']}</div><div class="l">Kept</div></div>
    <div class="sc"><div class="n revoke">{summary['revoked']}</div><div class="l">Revoked</div></div>
    <div class="sc"><div class="n none">{summary['no_decision']}</div><div class="l">No decision</div></div>
  </div>

  <div class="tb">
    <button onclick="document.querySelectorAll('details').forEach(function(d){{d.open=true}})">Expand all</button>
    <button onclick="document.querySelectorAll('details').forEach(function(d){{d.open=false}})">Collapse all</button>
    <button class="no-print" onclick="window.print()">Print / Save as PDF</button>
  </div>

  {body}

  <p class="foot">Generated by Catapult Applications Audit. This report is view-only.</p>
</div>
</body>
</html>"""
        return html, summary

    @staticmethod
    def _badge(decision: str) -> str:
        if decision == "keep":
            return '<span class="b keep">Keep</span>'
        if decision == "revoke":
            return '<span class="b revoke">Revoke</span>'
        return '<span class="b none">No decision</span>'

    @staticmethod
    def _render_person(
        person: Dict[str, Any],
        effective: Dict[str, str],
        decisions: Dict[str, Dict[str, Any]],
        highlights: Dict[str, str],
    ) -> str:
        name = escape(person["staff_name"])

        if not person.get("found"):
            return (
                f'<details class="uc"><summary><span class="s-name">{name} '
                f'<span class="mut">&middot; not found in report</span></span></summary></details>'
            )

        # per-person tallies (effective)
        p_ids = [
            perm["id"]
            for g in person["groups"]
            for a in g["apps"]
            for perm in a["permissions"]
        ]
        uk = sum(1 for i in p_ids if effective.get(i) == "keep")
        ur = sum(1 for i in p_ids if effective.get(i) == "revoke")

        groups_html = "".join(
            ReportService._render_group(g, effective, decisions, highlights)
            for g in person["groups"]
        )
        email = escape(person.get("email", ""))

        return f"""<details class="uc">
  <summary>
    <span class="s-name">{name} <span class="mut">&middot; {email}</span></span>
    <span class="s-tags"><span class="b keep">{uk} keep</span><span class="b revoke">{ur} revoke</span></span>
  </summary>
  {groups_html}
</details>"""

    @staticmethod
    def _render_group(
        group: Dict[str, Any],
        effective: Dict[str, str],
        decisions: Dict[str, Dict[str, Any]],
        highlights: Dict[str, str],
    ) -> str:
        label = escape(group["label"])
        apps_html = "".join(
            ReportService._render_app(a, effective, decisions, highlights)
            for a in group["apps"]
        )
        return f'<details class="grp"><summary><span class="s-l">{label}</span></summary>{apps_html}</details>'

    @staticmethod
    def _render_app(
        app: Dict[str, Any],
        effective: Dict[str, str],
        decisions: Dict[str, Dict[str, Any]],
        highlights: Dict[str, str],
    ) -> str:
        domain = escape(app["domain"])
        ak = sum(1 for p in app["permissions"] if effective.get(p["id"]) == "keep")
        ar = sum(1 for p in app["permissions"] if effective.get(p["id"]) == "revoke")

        leaves = ""
        for perm in app["permissions"]:
            pid = perm["id"]
            eff = effective.get(pid, "none")
            hl = pid in highlights
            note = (decisions.get(pid, {}) or {}).get("note", "")
            hl_note = highlights.get(pid, "")

            leaf_class = "leaf"
            if eff == "revoke":
                leaf_class += " rev"
            if hl:
                leaf_class += " hl"

            flag_icon = ' <span class="b fl">&#9733;</span>' if hl else ""
            pos_suffix = (
                " &middot; " + escape(perm["position"]) if perm.get("position") else ""
            )
            it_note = (
                f'<div class="itn">IT: {escape(hl_note)}</div>'
                if (hl and hl_note) else ""
            )
            mgr_note = f'<div class="pnote">{escape(note)}</div>' if note else ""

            leaves += (
                f'<div class="{leaf_class}">'
                f'<div class="lm"><span class="ln">{escape(perm["name"])}{flag_icon}</span>'
                f'<span class="src">{escape(perm["source"])}{pos_suffix}</span>'
                f'{it_note}{mgr_note}'
                f'</div>{ReportService._badge(eff)}</div>'
            )

        return (
            f'<details class="app"><summary><span class="s-l">{domain}</span>'
            f'<span class="s-c"><span class="b keep">{ak}</span><span class="b revoke">{ar}</span></span></summary>'
            f'{leaves}</details>'
        )

    @staticmethod
    def _styles() -> str:
        return """
body{margin:0;background:#f4f5f7;color:#1f2430;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.5}
.w{max-width:940px;margin:0 auto;padding:28px 20px 70px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin:0}
.ro{display:inline-block;background:#eef1f6;color:#41485a;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;margin-top:8px}
.ban{display:flex;gap:22px;flex-wrap:wrap;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:16px;margin:16px 0}
.ban .k{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;font-weight:600}.ban .v{font-weight:600;font-size:15px}
.sum{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px}
.sc{flex:1;min-width:120px;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:14px}
.sc .n{font-size:24px;font-weight:700}.sc .n.keep{color:#127a4b}.sc .n.revoke{color:#b3261e}.sc .n.none{color:#6b7280}
.sc .l{font-size:12px;color:#6b7280}
.tb{margin:6px 0 14px}
.tb button{font:inherit;font-size:13px;font-weight:600;background:#fff;border:1px solid #e3e6ec;border-radius:8px;padding:6px 12px;cursor:pointer;margin-right:8px}
details{border:1px solid #e3e6ec;border-radius:10px;background:#fff;margin:8px 0}
details.grp,details.app{margin:6px 0;border-color:#eef0f5}
summary{cursor:pointer;padding:11px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"\\25B6";color:#9aa1af;font-size:11px;margin-right:8px;transition:.15s}
details[open]>summary::before{transform:rotate(90deg)}
details.uc>summary{font-weight:600}
.s-name{flex:1}.mut{color:#6b7280;font-weight:400}
.s-l{flex:1;font-weight:600}.grp>summary .s-l{color:#1b3aa8}
.s-tags,.s-c{display:flex;gap:6px}
.leaf{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:9px 14px 9px 40px;border-top:1px solid #f2f3f7}
.leaf.hl{background:#fdf1e0}.leaf.rev .ln{text-decoration:line-through;color:#6b7280}
.ln{font-weight:500}.src{display:block;font-size:12px;color:#6b7280}
.itn{font-size:12px;color:#b45309;margin-top:2px}.pnote{font-size:12px;color:#41485a;font-style:italic;margin-top:2px}
.b{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
.b.keep{background:#e5f4ec;color:#127a4b}.b.revoke{background:#fbeaea;color:#b3261e}.b.none{background:#eef1f6;color:#6b7280}.b.fl{background:#fdf1e0;color:#b45309}
.foot{font-size:12px;color:#6b7280;text-align:center;margin-top:26px}
@media print{.no-print{display:none}body{background:#fff}details{break-inside:avoid}}
"""
