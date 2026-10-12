# METADATA
# title: Compose service has no CPU or memory limit
# description: Policy rule R7. Each service must set a CPU limit and a memory limit.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-006
#   avd_id: RL-DC-006
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-resource-limits
#   recommended_action: Set 'deploy.resources.limits.cpus' and 'deploy.resources.limits.memory' (or 'cpus' and 'mem_limit').
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_006

import data.lib.rlcompose
import rego.v1

limits(svc) := object.get(svc, ["deploy", "resources", "limits"], {})

has_memory(svc) if limits(svc).memory

has_memory(svc) if svc.mem_limit

has_cpu(svc) if limits(svc).cpus

has_cpu(svc) if svc.cpus

deny contains res if {
	some name, svc in rlcompose.services
	not has_memory(svc)
	res := result.new(sprintf("Service '%s' must set a memory limit (R7).", [name]), {})
}

deny contains res if {
	some name, svc in rlcompose.services
	not has_cpu(svc)
	res := result.new(sprintf("Service '%s' must set a CPU limit (R7).", [name]), {})
}
