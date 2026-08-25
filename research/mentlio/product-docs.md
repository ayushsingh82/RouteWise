# Mentlio — Product Documentation (archived)

Source: mentlio.com/docs, updated July 31, 2026. Archived here as competitor research for tokenmax — see [`../../COMPETITORS.md`](../../COMPETITORS.md).

> Use Mentlio with your engineering team. Set up the desktop agent, understand dashboards and Token Savers, manage integrations, and troubleshoot common issues.

## Getting started

Set up an organization, connect the systems your team uses, and activate the desktop agent.

1. **Create the organization** — a Mentlio administrator starts the organization onboarding flow, names the company, and confirms the initial team structure.
2. **Connect your engineering systems** — connect GitHub for delivery signals and, when applicable, Jira or Linear for issue context. Slack and Microsoft Teams can deliver digests and alerts.
3. **Invite employees** — invite employees with their work email and assign their team and manager. Each employee receives an account and installation flow.
4. **Install and activate Mentlio** — download the macOS or Windows desktop app from the employee setup flow, open it, and approve activation. The app confirms when the local agent is connected.

## Desktop agent

Mentlio measures AI-assisted work locally while keeping sensitive work content on the device.

The desktop agent supports **Claude Code, Codex, and Cursor** workflows. It runs locally, observes supported AI-tool activity, and computes the quality, workflow, and savings signals used by the dashboard.

For Cursor, the agent automatically uses the existing local Cursor sign-in to collect exact model, token, cache, and charged-cost records. No Cursor API key or administrator setup is required, and the Cursor credential and raw account identifiers never leave the device.

Raw prompts, raw outputs, source code, private files, and full local paths stay on the device. Mentlio sends derived telemetry — classifications, scores, token counts, model metadata, and aggregate savings measurements — to the organization dashboard.

- Use the menu-bar or system-tray app to confirm connection and activation status.
- Leave the agent running while using supported AI tools so activity can be measured.
- When a manager enables a monthly usage limit, Mentlio **blocks new prompts sent through its managed hooks and proxies** after the observed AI-spend cap is reached. Direct client connections that bypass the daemon cannot be enforced.
- If activation is lost, reopen the employee setup link or ask an administrator to send a new invitation.

## Dashboard

Use organization and team views to understand adoption, spend, savings, coaching opportunities, and delivery.

**Overview** summarizes current AI adoption, costs, savings, prompt quality, and engineering-delivery signals. Teams and employee profiles provide the same signals at the appropriate management scope.

**Savings** explains where Mentlio avoided model, context, response, and tool spend. **Productivity** and **delivery** views combine derived AI-usage signals with connected engineering-system data; they do not expose employee prompt text or source code.

- Use the date selector to compare the same metric over a consistent reporting window.
- Use Teams and employee profiles to investigate a change before acting on an organization-wide average.
- Use coaching and notification surfaces to turn findings into manager follow-up.

## Token Savers

Five local controls reduce avoidable AI cost while preserving the information an agent needs. Organization managers review saver controls in Mentlio's savings and routing settings; changes should be evaluated against the organization's model policy and developer workflow before broad rollout.

| Saver | What it does |
|---|---|
| **Route** | Selects a lower-cost capable model when the expected, cache-aware price difference makes the switch worthwhile. |
| **Lens** | Uses semantic code search to locate relevant code before an agent opens broad files or performs large text searches. |
| **Quiet** | Keeps agent responses concise while preserving commands, paths, errors, warnings, and requested detail. |
| **Logs** | Compresses positively identified test, build, compiler, and structured logs while retaining errors and useful summaries. |
| **Recall** | Replaces large eligible tool outputs with a local reversible marker so the exact stored output can be retrieved when needed. |

(See [`savings-methodology.md`](./savings-methodology.md) for how each saver's dashboard number is actually computed and evidenced.)

## Integrations

Connect only the systems needed for the workflows your organization wants to measure or notify. Administrators connect and manage integrations from the Integrations page.

- **GitHub** — repository and pull-request delivery signals.
- **Jira and Linear** — issue and project context for delivery reporting.
- **Slack and Microsoft Teams** — configured digests, coaching prompts, and threshold alerts.
- **Microsoft Entra ID** and supported sign-in providers — account authentication where configured.

If an integration stops updating, reconnect it and confirm the provider account still grants the requested organization/workspace access.

## Data and security

Mentlio minimizes uploaded data and separates product guidance from security and privacy policies.

The desktop agent performs sensitive prompt and code analysis **locally**. The hosted service receives only the derived telemetry required for dashboards, reporting, and configured notifications.

Access to organization data is authenticated and scoped by role. Administrators should remove accounts/integrations no longer required and review team assignments when responsibilities change.

## Troubleshooting and support

1. **Confirm the agent is active** — open the desktop app, verify activation/connection are healthy; restart after an OS update if it's no longer running.
2. **Confirm the integration** — reconnect the affected provider in the dashboard's Integrations page; verify the intended org/repo/project/workspace is still authorized.
3. **Check service status** — review the public status page for app, API, desktop-agent, or connected-service availability.
4. **Contact support** — email support@mentlio.com with account, approximate time, expected behavior, and non-sensitive error text only. Never send prompts, source code, credentials, or customer data.
