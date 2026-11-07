# AutoPharm host agent

Node 24, Docker Desktop and the existing Compose project are required. No npm
dependencies, inbound port, Docker socket mount or database credential is used.
The browser never receives this agent's token or Docker access.

Create ignored `development/host-agent.local.json`:

```json
{
  "backendUrl": "http://127.0.0.1:8000",
  "token": "GENERATE_A_PRIVATE_RANDOM_VALUE_AT_LEAST_32_CHARACTERS",
  "projectRoot": "D:\\Projects\\AutoPharm",
  "projectName": "autopharm",
  "intervalMs": 5000,
  "journalPath": "D:\\Projects\\AutoPharm\\development\\host-agent-state.json"
}
```

Set the same private token in backend `HOST_AGENT_TOKEN`. Keep configuration and
journal readable/writable only by the local operating-system account. Launch with
`node infrastructure/host-agent/agent.mjs development/host-agent.local.json` or the
hidden-window PowerShell helper. A per-user Task Scheduler logon task may invoke
the helper for automatic startup. Do not launch multiple agent instances.

Start/Stop/Restart target existing labelled AutoPharm app containers only. No
build, delete, prune, volume, shell, database, Redis, backend or Admin operation is
accepted. Mutations address exactly one freshly discovered container ID after
checking project/service labels. Compose is used only for read-only discovery,
so starting an app never starts protected dependencies. Stop and Restart request cooperative indefinite Docker termination;
the agent stops waiting after its bounded CLI timeout without force-killing a
container. Unconfirmed operations are UNKNOWN, not retried automatically.

The journal stores job IDs, service/action, before-start container identity/time,
and outcome. An interrupted intent is reported UNKNOWN after reconnect. Stop/Start
may resolve from their observed end state; Restart requires a later StartedAt on
the same container. Uncertainty blocks another service command and Kiosk access.
A lost claim with no durable intent is safely failed without executing it.
A repeated job ID never executes twice. A
damaged/unwritable journal disables actions. Do not erase it to retry a Restart;
inspect current service state and submit a new explicitly confirmed action.

Journal continuity is persisted with the entries. A missing journal starts
untrusted: first boot may establish a baseline only if the backend has no
unresolved commands. With outstanding work, missing history produces UNKNOWN,
never a claim of non-execution; new control claims remain disabled. A corrupt
journal is preserved for investigation while host monitoring continues.

Windows host CPU is normalised across host cores. Docker CPU uses Docker's
per-core percentage and may exceed 100%. Memory limits reported by Docker are
container/VM limits and are not the physical Windows RAM total.

Tests: `node --test infrastructure/host-agent/agent.test.mjs`. Tests use a fake
Docker runner; they never stop or restart the user's services.
