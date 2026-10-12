# METADATA
# title: Compose service does not drop all capabilities
# description: Policy rule R3. Each service must set 'cap_drop' to ALL and must not set 'cap_add'.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-003
#   avd_id: RL-DC-003
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-drop-all-capabilities
#   recommended_action: Set 'cap_drop' to [ALL]. Remove 'cap_add'.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_003

import data.lib.rlcompose
import rego.v1

drops_all(svc) if {
	some cap in object.get(svc, "cap_drop", [])
	upper(cap) == "ALL"
}

deny contains res if {
	some name, svc in rlcompose.services
	not drops_all(svc)
	res := result.new(sprintf("Service '%s' must set 'cap_drop: [ALL]' (R3).", [name]), {})
}

deny contains res if {
	some name, svc in rlcompose.services
	count(object.get(svc, "cap_add", [])) > 0
	res := result.new(sprintf("Service '%s' must not set 'cap_add' (R3).", [name]), {})
}
