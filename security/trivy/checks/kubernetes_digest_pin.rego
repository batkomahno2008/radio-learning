# METADATA
# title: Kubernetes container image is not pinned by digest
# description: Policy section 8.2. Pin each image by digest (image:tag@sha256:...), except the two published images.
# scope: package
# schemas:
#   - input: schema["kubernetes"]
# custom:
#   id: RL-KS-001
#   avd_id: RL-KS-001
#   provider: kubernetes
#   service: general
#   severity: HIGH
#   short_code: k8s-image-digest-pin
#   recommended_action: Add '@sha256:<digest>' to the image reference. Keep the tag for the reader.
#   input:
#     selector:
#       - type: kubernetes
package user.kubernetes.rl_ks_001

import data.lib.rlkubernetes
import rego.v1

deny contains res if {
	some c in rlkubernetes.containers
	not rlkubernetes.published_image(c.image)
	not contains(c.image, "@sha256:")
	res := result.new(sprintf("Container '%s' uses image '%s' with no digest (8.2).", [c.name, c.image]), c)
}
