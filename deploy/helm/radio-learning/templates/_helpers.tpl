{{- define "rl.name" -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}

{{- define "rl.labels" -}}
app.kubernetes.io/part-of: radio-learning
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* selector labels: rl.sel (dict "root" . "name" "x") */}}
{{- define "rl.sel" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "rl.secretName" -}}
{{- default (printf "%s-db" (include "rl.name" .)) .Values.database.existingSecret -}}
{{- end -}}

{{- define "rl.pullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "rl.appImage" -}}
{{ .Values.images.app.repository }}:{{ default .Chart.AppVersion .Values.images.app.tag }}
{{- end -}}

{{- define "rl.proxyImage" -}}
{{ .Values.images.proxy.repository }}:{{ default .Chart.AppVersion .Values.images.proxy.tag }}
{{- end -}}
