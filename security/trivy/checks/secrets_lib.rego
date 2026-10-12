# Shared helpers for the R9 checks (RL-DC-008 for Compose, RL-KS-003 for Kubernetes).
package lib.rlsecrets

import rego.v1

# A variable name that usually holds a secret. A name that ends with _FILE holds a path, not a secret.
secret_name(key) if {
	regex.match(`(?i)(password|passwd|secret|token|api_?key|private_?key)`, key)
	not endswith(upper(key), "_FILE")
}

# A value that comes only from interpolation, for example ${POSTGRES_PASSWORD} or $TOKEN.
interpolated(value) if regex.match(`^\$\{?[A-Za-z_][A-Za-z0-9_]*(:?[-?+][^}]*)?\}?$`, value)

# A literal value: not empty and not interpolation.
literal(value) if {
	v := sprintf("%v", [value])
	v != ""
	not interpolated(v)
}

# The password part of a URL such as scheme://user:password@host.
url_password(value) := pw if {
	m := regex.find_all_string_submatch_n(`^[A-Za-z][A-Za-z0-9+.-]*://[^:/@\s]*:([^@\s]*)@`, sprintf("%v", [value]), 1)
	count(m) == 1
	pw := m[0][1]
}

# A URL with a literal password. "${VAR}" in the password part is correct.
url_with_literal_password(value) if {
	pw := url_password(value)
	literal(pw)
}

# The finding for one variable, or nothing when the variable is correct.
problem(key, value) := sprintf("a literal value for '%s'", [key]) if {
	secret_name(key)
	literal(value)
} else := sprintf("a URL with a literal password in '%s'", [key]) if {
	url_with_literal_password(value)
}
