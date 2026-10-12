# METADATA
# title: Compose service root file system is not read-only
# description: Policy rule R2. Each service must set 'read_only' to true.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-002
#   avd_id: RL-DC-002
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-read-only
#   recommended_action: Set 'read_only' to true. Mount 'tmpfs' only on the paths that policy section 7 allows.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_002

import data.lib.rlcompose
import rego.v1

deny contains res if {
	some name, svc in rlcompose.services
	object.get(svc, "read_only", false) != true
	res := result.new(sprintf("Service '%s' must set 'read_only: true' (R2).", [name]), {})
}
