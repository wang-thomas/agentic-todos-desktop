def _desktop_runner_impl(ctx):
    executable = ctx.actions.declare_file(ctx.label.name + ".sh")
    ctx.actions.write(
        executable,
        """#!/usr/bin/env bash
set -euo pipefail

LOCAL_SERVER_URL="${LOCAL_SERVER_URL:-%s}"

if [[ "${RUN_LOCAL:-}" == "1" ]]; then
  export AGENTIC_TODOS_SERVER_URL="${AGENTIC_TODOS_SERVER_URL:-$LOCAL_SERVER_URL}"
fi

cd "${BUILD_WORKSPACE_DIRECTORY:-$(pwd)}"
exec npm run dev "$@"
""" % ctx.attr.local_server_url,
        is_executable = True,
    )
    return DefaultInfo(executable = executable)

desktop_runner = rule(
    implementation = _desktop_runner_impl,
    attrs = {
        "local_server_url": attr.string(mandatory = True),
    },
    executable = True,
)
