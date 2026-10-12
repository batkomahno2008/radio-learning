# METADATA
# title: Compose image is not pinned by digest
# description: Policy section 8.2. Pin each image by digest (image:tag@sha256:...), except the two published images.
# scope: package
# schemas:
#   - input: schema["compose"]
# custom:
#   id: RL-DC-010
#   avd_id: RL-DC-010
#   provider: generic
#   service: compose
#   severity: HIGH
#   short_code: compose-image-digest-pin
#   recommended_action: Add '@sha256:<digest>' to the image reference. Keep the tag for the reader.
#   input:
#     selector:
#       - type: yaml
package user.compose.rl_dc_010

import data.lib.rlcompose
import rego.v1

deny contains res if {
	some name, svc in rlcompose.services
	img := object.get(svc, "image", "")
	img != ""
	not rlcompose.published_image(img)
	not rlcompose.pinned_by_digest(img)
	res := result.new(sprintf("Service '%s' uses image '%s' with no digest (8.2).", [name, img]), {})
}
