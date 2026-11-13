# Parsec: fixing errors -6023 / -11010 (for the Claude session on the HOME PC)

## What was found (2026-11-13, on the university lab PC)

* The client PC is a university lab machine (domain-joined, no admin rights, public IP in a campus range).
  It runs the portable Parsec (`Downloads\parsec-flat-windows\parsecd.exe`).
* Parsec's log there: the STUN server answers (so outbound UDP works), then the connection ends with
  `-6023 / -11010` every time. Both codes mean the direct peer-to-peer link between client and host could
  not be formed (NAT hole punching failed). Parsec has no free relay.
* Tailscale was tried and **cannot be installed on the lab PC**: the installer needs administrator rights
  (`This package requires elevated privileges`). Tailscale's no-admin "userspace" mode only gives a proxy,
  which Parsec can't use. Don't try to work around the lab PC's restrictions.

So the fix has to be on the **home** side: make the home PC directly reachable, which is Parsec's own
documented fix for 6023.

## Do this on the home PC (ask the user before each step that changes settings)

1. **Check the home network first**
   * `ipconfig` → note the PC's LAN IP and the gateway (router) IP.
   * Public IP: `curl -s https://api.ipify.org`. Open the router's admin page (gateway IP) and compare its
     WAN IP with that. If the router's WAN IP is different and looks like `10.x`, `100.64–127.x` or `192.168.x`,
     the ISP uses CG-NAT: port forwarding will NOT work → go to "If CG-NAT" below.
2. **Give the PC a fixed LAN IP** (DHCP reservation in the router for the PC's MAC address).
3. **Parsec host port**: in Parsec → Settings → Network set **Host Start Port = 8000**
   (or add `"host_start_port": { "value": 8000 }` to Parsec's `config.json`, then restart Parsec).
   Parsec then uses UDP 8000–8010.
4. **Router**: forward **UDP 8000–8010** to the home PC's LAN IP. (Alternative: enable UPnP in the router;
   Parsec uses it automatically. A manual forward is more reliable.) The user must log in to the router
   themselves: never type the router password for them.
5. **Windows Firewall**: Parsec normally adds its own rule. If not:
   `New-NetFirewallRule -DisplayName "Parsec host" -Direction Inbound -Protocol UDP -LocalPort 8000-8010 -Action Allow`
   (needs an admin PowerShell; ask first).
6. **Test**: connect from a phone on mobile data (Parsec app) first, then from the lab PC.
   In the host's `log.txt` a working connection shows the client connecting without `-11010`.

## If CG-NAT (no public IP at home)

* Ask the ISP for a public IP (many give one free or cheaply), or check whether the router has IPv6
  and Parsec can use it.
* Otherwise Parsec can't work between these two networks. Use RustDesk (the site's Remote tab), which
  relays through its own servers.

## Notes

* The lab PC's network rules are the university's. If its firewall blocks Parsec even with the home
  port open, that's a policy decision: ask the university's IT, don't tunnel around it.
* Keep Parsec's account protected with 2FA: an open host port only accepts Parsec-authenticated peers,
  but the account is the key.
