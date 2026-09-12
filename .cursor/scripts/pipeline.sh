#!/usr/bin/env bash
# Live /api/ai/pipelines helper. Do not put tokens in this file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PIPELINES_DIR="${PIPELINE_DISK_DIR:-${REPO_ROOT}/src/main/resources/pipelines}"

load_pipeline_env() {
	local file line key val
	for file in "${REPO_ROOT}/.env" "${REPO_ROOT}/.env.local"; do
		[[ -f "${file}" ]] || continue
		while IFS= read -r line || [[ -n "${line}" ]]; do
			line="${line%$'\r'}"
			[[ "${line}" =~ ^[[:space:]]*# ]] && continue
			[[ "${line}" =~ ^[[:space:]]*$ ]] && continue
			[[ "${line}" =~ ^PIPELINE_[A-Z0-9_]+= ]] || continue
			key="${line%%=*}"
			val="${line#*=}"
			val="${val#\"}"
			val="${val%\"}"
			val="${val#\'}"
			val="${val%\'}"
			if [[ -z "${!key:-}" ]]; then
				export "${key}=${val}"
			fi
		done < "${file}"
	done
}

load_pipeline_env
BASE_URL="${PIPELINE_BASE_URL:-https://ai.sugartech.io}"
API="${BASE_URL%/}/api/ai/pipelines"

usage() {
	cat <<'EOF'
Usage: pipeline.sh <command> [args]

  list
  get <identifier>
  create [file|-]
  update <identifier> [file|-]
  delete <identifier>
  validate [file|-]
  preview [file|-]
  run <identifier> [file|-]
  run-async <identifier> [file|-]
  job <jobId>
  versions <identifier>
  version <identifier> <n>
  snapshot <identifier> [note]
  restore <identifier> <n>
  duplicate <identifier>
  pack <identifier>          # disk files → create JSON (stdout, no HTTP)
  validate-disk <identifier> # pack + POST /validate on ai.sugartech.io

Body commands read JSON from a file or stdin.

Env (also loaded from repo .env then .env.local, PIPELINE_* only):
  PIPELINE_BASE_URL          default https://ai.sugartech.io
  PIPELINE_TOKEN             Bearer token
  PIPELINE_EMAIL             login (with PIPELINE_PASSWORD)
  PIPELINE_PASSWORD
  PIPELINE_BASIC_USER        HTTP Basic (with PIPELINE_BASIC_PASSWORD)
  PIPELINE_BASIC_PASSWORD
  PIPELINE_INSECURE=1        curl -k for local certs
  PIPELINE_DISK_DIR          override resources/pipelines
EOF
}

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "pipeline.sh: missing command: $1" >&2
		exit 1
	fi
}

read_body() {
	local path="${1:-}"
	if [[ -z "${path}" || "${path}" == "-" ]]; then
		if [[ -t 0 ]]; then
			echo "pipeline.sh: expected JSON on stdin or a file path" >&2
			exit 1
		fi
		cat
		return
	fi
	if [[ ! -f "${path}" ]]; then
		echo "pipeline.sh: file not found: ${path}" >&2
		exit 1
	fi
	cat "${path}"
}

curl_opts=()
if [[ "${PIPELINE_INSECURE:-}" == "1" ]]; then
	curl_opts+=(-k)
fi

login_if_needed() {
	if [[ -n "${PIPELINE_TOKEN:-}" ]]; then
		return
	fi
	if [[ -z "${PIPELINE_EMAIL:-}" || -z "${PIPELINE_PASSWORD:-}" ]]; then
		return
	fi
	require_cmd jq
	local payload response token
	payload="$(jq -n --arg email "${PIPELINE_EMAIL}" --arg password "${PIPELINE_PASSWORD}" \
		'{email: $email, password: $password}')"
	response="$(curl -sS "${curl_opts[@]}" \
		-H "Content-Type: application/json" \
		-H "Accept: application/json" \
		-X POST "${BASE_URL%/}/api/v1/auth/login" \
		-d "${payload}")"
	token="$(printf '%s' "${response}" | jq -r '.accessToken // .access_token // empty')"
	if [[ -z "${token}" ]]; then
		echo "pipeline.sh: login failed" >&2
		printf '%s\n' "${response}" >&2
		exit 1
	fi
	PIPELINE_TOKEN="${token}"
}

auth_args() {
	login_if_needed
	if [[ -n "${PIPELINE_TOKEN:-}" ]]; then
		printf '%s\n' "-H" "Authorization: Bearer ${PIPELINE_TOKEN}"
	elif [[ -n "${PIPELINE_BASIC_USER:-}" && -n "${PIPELINE_BASIC_PASSWORD:-}" ]]; then
		printf '%s\n' "-u" "${PIPELINE_BASIC_USER}:${PIPELINE_BASIC_PASSWORD}"
	fi
}

http() {
	require_cmd curl
	local method="$1"
	local url="$2"
	shift 2
	local -a args=("${curl_opts[@]}" -sS -w "\n%{http_code}" -X "${method}" "${url}")
	local -a auth
	mapfile -t auth < <(auth_args)
	if [[ ${#auth[@]} -gt 0 ]]; then
		args+=("${auth[@]}")
	fi
	args+=(-H "Accept: application/json" "$@")
	local raw status body
	raw="$(curl "${args[@]}")"
	status="${raw##*$'\n'}"
	body="${raw%$'\n'*}"
	if [[ "${status}" -ge 400 ]]; then
		echo "pipeline.sh: HTTP ${status} ${method} ${url}" >&2
		printf '%s\n' "${body}" >&2
		exit 1
	fi
	printf '%s\n' "${body}"
}

json_http() {
	local method="$1"
	local url="$2"
	local body="$3"
	http "${method}" "${url}" -H "Content-Type: application/json" -d "${body}"
}

pack_disk() {
	require_cmd jq
	local id="$1"
	local js="${PIPELINES_DIR}/${id}.js"
	local input="${PIPELINES_DIR}/${id}.input.json"
	local output="${PIPELINES_DIR}/${id}.output.json"
	if [[ ! -f "${js}" ]]; then
		echo "pipeline.sh: missing ${js}" >&2
		exit 1
	fi
	if [[ ! -f "${input}" ]]; then
		echo "pipeline.sh: missing ${input}" >&2
		exit 1
	fi
	if [[ ! -f "${output}" ]]; then
		echo "pipeline.sh: missing ${output}" >&2
		exit 1
	fi
	jq -n \
		--arg identifier "${id}" \
		--arg name "${id}" \
		--arg source "$(cat "${js}")" \
		--slurpfile input "${input}" \
		--slurpfile output "${output}" \
		'{
			identifier: $identifier,
			name: $name,
			source: $source,
			enabled: true,
			credits: 0,
			input: $input[0],
			output: $output[0]
		}'
}

cmd="${1:-}"
if [[ -z "${cmd}" || "${cmd}" == "-h" || "${cmd}" == "--help" ]]; then
	usage
	exit 0
fi
shift

case "${cmd}" in
	list)
		http GET "${API}"
		;;
	get)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		http GET "${API}/$1"
		;;
	create)
		json_http POST "${API}" "$(read_body "${1:-}")"
		;;
	update)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		json_http PUT "${API}/$1" "$(read_body "${2:-}")"
		;;
	delete)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		http DELETE "${API}/$1"
		;;
	validate)
		json_http POST "${API}/validate" "$(read_body "${1:-}")"
		;;
	preview)
		json_http POST "${API}/preview" "$(read_body "${1:-}")"
		;;
	run)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		if [[ $# -ge 2 || ! -t 0 ]]; then
			json_http POST "${API}/$1/run" "$(read_body "${2:-}")"
		else
			json_http POST "${API}/$1/run" "{}"
		fi
		;;
	run-async)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		if [[ $# -ge 2 || ! -t 0 ]]; then
			json_http POST "${API}/$1/run-async" "$(read_body "${2:-}")"
		else
			json_http POST "${API}/$1/run-async" "{}"
		fi
		;;
	job)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		http GET "${API}/jobs/$1"
		;;
	versions)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		http GET "${API}/$1/versions"
		;;
	version)
		[[ $# -ge 2 ]] || { usage >&2; exit 1; }
		http GET "${API}/$1/versions/$2"
		;;
	snapshot)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		if [[ $# -ge 2 ]]; then
			require_cmd jq
			json_http POST "${API}/$1/versions" "$(jq -n --arg note "$2" '{note: $note}')"
		else
			json_http POST "${API}/$1/versions" "{}"
		fi
		;;
	restore)
		[[ $# -ge 2 ]] || { usage >&2; exit 1; }
		http POST "${API}/$1/versions/$2/restore"
		;;
	duplicate)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		http POST "${API}/$1/duplicate"
		;;
	pack)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		pack_disk "$1"
		;;
	validate-disk)
		[[ $# -ge 1 ]] || { usage >&2; exit 1; }
		require_cmd jq
		json_http POST "${API}/validate" "$(pack_disk "$1" | jq '{source, input, output}')"
		;;
	*)
		echo "pipeline.sh: unknown command: ${cmd}" >&2
		usage >&2
		exit 1
		;;
esac
