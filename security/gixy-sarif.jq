# Change the JSON report of gixy-ng into SARIF 2.1.0 (scan target S6).
# gixy-ng has no SARIF output. Policy section 6 needs SARIF for the GitHub Security tab.
#
# Usage: jq --arg root /etc/nginx/ --arg prefix deploy/nginx/ -f security/gixy-sarif.jq gixy.json > s6.sarif
#   root    The directory of the config in the gixy run. The script removes it from each path.
#   prefix  The repository path of that directory. The script adds it to each path.
#
# Severity: HIGH -> error (security-severity 7.5), MEDIUM -> warning (5.0), LOW -> note (2.0).
# The gate (policy 3.2, S6) counts the results with security-severity 7.0 or more.

def level: {"HIGH": "error", "MEDIUM": "warning", "LOW": "note"}[.] // "note";
def score: {"HIGH": "7.5", "MEDIUM": "5.0", "LOW": "2.0"}[.] // "0.0";
def relpath: (if startswith($root) then .[($root | length):] else . end) | $prefix + .;

{
  "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "gixy-ng",
        "informationUri": "https://github.com/dvershinin/gixy",
        "rules": (map({plugin, summary, description, reference, severity})
          | group_by(.plugin)
          | map(.[0] as $f | {
              id: $f.plugin,
              name: $f.plugin,
              shortDescription: {text: $f.summary},
              fullDescription: {text: $f.description},
              helpUri: $f.reference,
              properties: {"security-severity": ([.[].severity] | map(score) | max), tags: ["security", "nginx"]}
            }))
      }
    },
    "results": map({
      ruleId: .plugin,
      level: (.severity | level),
      message: {text: ((.summary // "") + ". " + (.reason // ""))},
      locations: [{
        physicalLocation: {
          artifactLocation: {uri: (.path // .file | relpath)},
          region: {startLine: ((.line // 1) | if . < 1 then 1 else . end)}
        }
      }]
    })
  }]
}
