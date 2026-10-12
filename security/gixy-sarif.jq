# Change the JSON report of gixy-ng into SARIF 2.1.0 (scan target S6).
# gixy-ng has no SARIF output. Policy section 6 needs SARIF for the GitHub Security tab.
#
# Usage: jq -f security/gixy-sarif.jq gixy.json > s6-nginx.sarif
#
# gixy-ng reads the config that the started proxy container uses (see security/s6-gixy.sh).
# This script changes each path in the container to the file in the repository:
#   /etc/nginx/nginx.conf               -> deploy/nginx/nginx.conf
#   /etc/nginx/snippets/<file>          -> deploy/nginx/snippets/<file>
#   /etc/nginx/tls/<file>               -> deploy/nginx/tls/<file>
#   /etc/nginx/templates/<file>         -> deploy/nginx/templates/<file>
#   /tmp/nginx/conf.d/<name>.conf       -> deploy/nginx/templates/<name>.conf.template
#                                          (envsubst keeps the line numbers)
#   /tmp/nginx/<other file>             -> deploy/nginx/docker-entrypoint.d/15-radio-learning.envsh
#                                          (the start script writes these files)
#   other paths                         -> the path with no leading "/" (a file of the base image)
#
# Severity: HIGH -> error (security-severity 7.5), MEDIUM -> warning (5.0), LOW -> note (2.0).
# The gate (policy 3.2, S6) counts the results with security-severity 7.0 or more.

def level: {"HIGH": "error", "MEDIUM": "warning", "LOW": "note"}[.] // "note";
def score: {"HIGH": "7.5", "MEDIUM": "5.0", "LOW": "2.0"}[.] // "0.0";
def repo_path:
  if test("^/etc/nginx/(nginx\\.conf|snippets/|tls/|templates/)") then sub("^/etc/nginx/"; "deploy/nginx/")
  elif test("^/tmp/nginx/conf\\.d/[^/]+\\.conf$") then sub("^/tmp/nginx/conf\\.d/(?<n>[^/]+)\\.conf$"; "deploy/nginx/templates/\(.n).conf.template")
  elif startswith("/tmp/nginx/") then "deploy/nginx/docker-entrypoint.d/15-radio-learning.envsh"
  else ltrimstr("/")
  end;

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
          # 'file' is the file that has the problem. 'path' is always the root file (nginx.conf).
          artifactLocation: {uri: ((.file // .path) | repo_path)},
          region: {startLine: ((.line // 1) | if . < 1 then 1 else . end)}
        }
      }]
    })
  }]
}
