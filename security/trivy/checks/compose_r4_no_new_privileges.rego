# METADATA
# title: Compose service allows privilege escalation
# description: Policy rule R4. Each service must set 'security_opt' to include no-new-privileges:true.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-004
#   avd_id: RL-DC-004
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-no-new-privileges
#   recommended_action: Add "no-new-privileges:true" to 'security_opt'.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_004

import data.lib.rlcompose
import rego.v1

accepted := {"no-new-privileges", "no-new-privileges:true", "no-new-privileges=true"}

has_nnp(svc) if {
	some opt in rlcompose.security_opts(svc)
	lower(opt) in accepted
}

deny contains res if {
	some name, svc in rlcompose.services
	not has_nnp(svc)
	res := result.new(sprintf("Service '%s' must set 'security_opt: [\"no-new-privileges:true\"]' (R4).", [name]), {})
}
