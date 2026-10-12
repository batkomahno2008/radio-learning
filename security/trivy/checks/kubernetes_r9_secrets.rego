# METADATA
# title: Kubernetes container has a secret value in the manifest
# description: Policy rule R9. Do not write a password, token or key as a literal 'env[].value'. This includes a URL with a password, for example DATABASE_URL. Use 'valueFrom.secretKeyRef'.
# scope: package
# schemas:
#   - input: schema["kubernetes"]
# custom:
#   id: RL-KS-003
#   avd_id: RL-KS-003
#   provider: kubernetes
#   service: general
#   severity: HIGH
#   short_code: k8s-no-literal-secret
#   recommended_action: Put the value in a Secret and use 'valueFrom.secretKeyRef'.
#   input:
#     selector:
#       - type: kubernetes
package user.kubernetes.rl_ks_003

import data.lib.rlkubernetes
import data.lib.rlsecrets
import rego.v1

deny contains res if {
	some c in rlkubernetes.containers
	some e in object.get(c, "env", [])
	value := object.get(e, "value", "")
	msg := rlsecrets.problem(e.name, value)
	res := result.new(sprintf("Container '%s' has %s (R9).", [c.name, msg]), c)
}
