# METADATA
# title: Compose service turns off the default seccomp profile
# description: Policy rule R5. A service must not set seccomp to unconfined.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-005
#   avd_id: RL-DC-005
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-default-seccomp
#   recommended_action: Remove "seccomp:unconfined" from 'security_opt'.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_005

import data.lib.rlcompose
import rego.v1

deny contains res if {
	some name, svc in rlcompose.services
	some opt in rlcompose.security_opts(svc)
	regex.match(`^seccomp[:=]unconfined$`, lower(opt))
	res := result.new(sprintf("Service '%s' must not set 'seccomp:unconfined' (R5).", [name]), {})
}
