# METADATA
# title: Compose service other than the NGINX proxy publishes ports
# description: Policy rule R8. Only the NGINX service ('proxy') can have 'ports'. The app and Postgres must have no 'ports'.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-007
#   avd_id: RL-DC-007
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-only-proxy-ports
#   recommended_action: Remove 'ports' from all services except 'proxy'. Use 'expose' or the internal network.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_007

import data.lib.rlcompose
import rego.v1

# The name of the NGINX service in compose.yaml. Change it here if issue #8 uses a different name.
edge_services := {"proxy"}

deny contains res if {
	some name, svc in rlcompose.services
	not name in edge_services
	count(object.get(svc, "ports", [])) > 0
	res := result.new(sprintf("Service '%s' must not publish 'ports'. Only the NGINX service can (R8).", [name]), {})
}
