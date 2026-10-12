# METADATA
# title: Compose service has a secret value in the file
# description: Policy rule R9. Do not write a password, token or key as a literal value in 'environment'. This includes a URL with a password, for example DATABASE_URL. Use an env file or a secret file that is not in Git.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-008
#   avd_id: RL-DC-008
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-no-literal-secret
#   recommended_action: Use '${VARIABLE}' interpolation (also for the password part of a URL), 'env_file' or 'secrets'.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_008

import data.lib.rlcompose
import data.lib.rlsecrets
import rego.v1

deny contains res if {
	some name, svc in rlcompose.services
	some key, value in rlcompose.env_map(svc)
	msg := rlsecrets.problem(key, value)
	res := result.new(sprintf("Service '%s' has %s (R9).", [name, msg]), {})
}
