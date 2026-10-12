# METADATA
# title: Compose service does not run as a numeric non-root user
# description: Policy rule R1. Each service must set 'user' to a numeric UID that is not 0.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-001
#   avd_id: RL-DC-001
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-non-root-user
#   recommended_action: Set 'user' to a numeric UID that is not 0, for example "10001:10001".
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_001

import data.lib.rlcompose
import rego.v1

numeric_non_root(user) if regex.match(`^[1-9][0-9]*(:[0-9]+)?$`, sprintf("%v", [user]))

deny contains res if {
	some name, svc in rlcompose.services
	not numeric_non_root(object.get(svc, "user", ""))
	res := result.new(sprintf("Service '%s' must set 'user' to a numeric UID that is not 0 (R1).", [name]), {})
}
