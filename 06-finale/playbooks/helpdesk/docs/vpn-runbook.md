---
groups: [everyone]
---
# VPN runbook
The VPN client is installed from the self-service portal. Sign in with your work account and approve the MFA prompt on your phone.

## When the VPN will not connect
Check that your laptop clock is correct first, because the certificate check fails when the time is off. Then quit and restart the client. If it still fails, note the error code in the client log and open a ticket so netops can look at the gateway.

## Slow VPN
Close large sync jobs and try the nearest gateway in the client menu.
