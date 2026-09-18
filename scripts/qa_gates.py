"""Fail closed when a required browser engine is missing, blocked, or fails."""
def qa_success(results):
    return (
        any(r.get('webkit_mobile') == 'pass' for r in results)
        and all(not r.get('violations') and not r.get('errors') for r in results)
        and all(r.get('webkit_mobile', 'pass') == 'pass' for r in results)
    )
