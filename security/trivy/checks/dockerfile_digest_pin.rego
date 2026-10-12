# METADATA
# title: Dockerfile base image is not pinned by digest
# description: Policy section 8.2. Pin each FROM image by digest (image:tag@sha256:...). A FROM that names an earlier stage is correct.
# scope: package
# schemas:
#   - input: schema["dockerfile"]
# custom:
#   id: RL-DS-001
#   avd_id: RL-DS-001
#   provider: dockerfile
#   service: general
#   severity: HIGH
#   short_code: dockerfile-from-digest-pin
#   recommended_action: Write 'FROM image:tag@sha256:<digest>'. Keep the tag for the reader.
#   input:
#     selector:
#       - type: dockerfile
package user.dockerfile.rl_ds_001

import rego.v1

from_cmds := [cmd |
	some stage in input.Stages
	some cmd in stage.Commands
	cmd.Cmd == "from"
]

# Names of the stages ("FROM image AS name").
stage_names contains lower(cmd.Value[2]) if {
	some cmd in from_cmds
	count(cmd.Value) == 3
	lower(cmd.Value[1]) == "as"
}

deny contains res if {
	some cmd in from_cmds
	img := cmd.Value[0]
	not lower(img) in stage_names
	lower(img) != "scratch"
	not contains(img, "@sha256:")
	res := result.new(sprintf("FROM '%s' has no digest (8.2).", [img]), cmd)
}
