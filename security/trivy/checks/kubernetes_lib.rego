# Shared helpers for the RL-KS checks (Kubernetes, scan target S5).
package lib.rlkubernetes

import rego.v1

# The pod spec of each workload kind that the project uses.
pod_specs contains input.spec if input.kind == "Pod"

pod_specs contains input.spec.template.spec if input.kind in {"Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"}

pod_specs contains input.spec.jobTemplate.spec.template.spec if input.kind == "CronJob"

containers contains c if {
	some spec in pod_specs
	some field in ["initContainers", "containers", "ephemeralContainers"]
	some c in object.get(spec, field, [])
}

published_image(img) if startswith(img, "ghcr.io/batkomahno2008/radio-learning:")

published_image(img) if startswith(img, "ghcr.io/batkomahno2008/radio-learning-proxy:")
