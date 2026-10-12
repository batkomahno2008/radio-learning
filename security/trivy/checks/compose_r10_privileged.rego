# METADATA
# title: Compose service is privileged or uses a host namespace
# description: "Policy rule R10. Do not set 'privileged', 'network_mode: host', 'pid: host' or 'ipc: host'."
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-009
#   avd_id: RL-DC-009
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-no-privileged-no-host
#   recommended_action: Remove 'privileged' and the host namespace settings.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_009

import data.lib.rlcompose
import rego.v1

deny contains res if {
	some name, svc in rlcompose.services
	object.get(svc, "privileged", false) == true
	res := result.new(sprintf("Service '%s' must not set 'privileged: true' (R10).", [name]), {})
}

deny contains res if {
	some name, svc in rlcompose.services
	some field in ["network_mode", "pid", "ipc"]
	lower(sprintf("%v", [object.get(svc, field, "")])) == "host"
	res := result.new(sprintf("Service '%s' must not set '%s: host' (R10).", [name, field]), {})
}
