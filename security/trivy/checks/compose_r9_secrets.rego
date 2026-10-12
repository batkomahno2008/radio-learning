# METADATA
# title: Compose service has a secret value in the file
# description: Policy rule R9. Do not write a password, token or key as a literal value in 'environment'. Use an env file or a secret file that is not in Git.
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
#   recommended_action: Use '${VARIABLE}' interpolation, 'env_file' or 'secrets'.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_008

import data.lib.rlcompose
import rego.v1

secret_name(key) if regex.match(`(?i)(password|passwd|secret|token|api_?key|private_?key)`, key)

# A value is safe when it is empty, or when it comes from interpolation, for example ${POSTGRES_PASSWORD}.
literal(value) if {
	v := sprintf("%v", [value])
	v != ""
	not regex.match(`^\$\{?[A-Za-z_][A-Za-z0-9_]*(:?[-?][^}]*)?\}?$`, v)
}

deny contains res if {
	some name, svc in rlcompose.services
	some key, value in rlcompose.env_map(svc)
	secret_name(key)
	not endswith(upper(key), "_FILE")
	literal(value)
	res := result.new(sprintf("Service '%s' has a literal value for '%s' (R9).", [name, key]), {})
}
