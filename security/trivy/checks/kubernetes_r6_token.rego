# METADATA
# title: Kubernetes pod mounts a service account token
# description: Policy rule R6. Each pod spec must set 'automountServiceAccountToken' to false.
# scope: package
# schemas:
#   - input: schema["kubernetes"]
# custom:
#   id: RL-KS-002
#   avd_id: RL-KS-002
#   provider: kubernetes
#   service: general
#   severity: HIGH
#   short_code: k8s-no-service-account-token
#   recommended_action: "Set 'automountServiceAccountToken: false' in the pod spec."
#   input:
#     selector:
#       - type: kubernetes
package user.kubernetes.rl_ks_002

import data.lib.rlkubernetes
import rego.v1

deny contains res if {
	some spec in rlkubernetes.pod_specs
	object.get(spec, "automountServiceAccountToken", true) != false
	res := result.new(sprintf("%s '%s' must set 'automountServiceAccountToken: false' (R6).", [input.kind, input.metadata.name]), spec)
}
