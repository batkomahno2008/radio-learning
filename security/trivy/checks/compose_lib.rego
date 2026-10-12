# Shared helpers for the RL-DC checks (Docker Compose, scan target S4).
package lib.rlcompose

import rego.v1

# The services of the Compose file, as name -> service.
services := object.get(input, "services", {})

# The value of security_opt as a list of strings.
security_opts(svc) := object.get(svc, "security_opt", [])

# The environment of a service as a map. Compose allows a map or a list of "KEY=value".
env_map(svc) := env if {
	env := object.get(svc, "environment", {})
	is_object(env)
}

env_map(svc) := {k: v |
	some item in object.get(svc, "environment", [])
	parts := split(item, "=")
	count(parts) > 1
	k := parts[0]
	v := concat("=", array.slice(parts, 1, count(parts)))
} if {
	is_array(object.get(svc, "environment", {}))
}

# Images that the project publishes. Policy 8.2 lets them use a tag with no digest.
published_image(img) if startswith(img, "ghcr.io/batkomahno2008/radio-learning:")

published_image(img) if startswith(img, "ghcr.io/batkomahno2008/radio-learning-proxy:")

pinned_by_digest(img) if contains(img, "@sha256:")
