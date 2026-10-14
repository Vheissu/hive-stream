# Security Policy

## Reporting a vulnerability

Email **dwaynecharrington@gmail.com** with the subject `hive-stream security`, or use GitHub's private vulnerability reporting on the repository. Please include the version, a description of the problem and, if you can, a minimal reproduction with the offline testing kit (`hive-stream/testing`). Don't open a public issue for anything that could be used to take funds from a running app.

You will get an acknowledgement within three days. Confirmed issues are fixed in a patch release and credited in the changelog unless you prefer otherwise.

## Supported versions

| Version | Supported |
| --- | --- |
| 5.x | Yes |
| 4.x | Security fixes only, until 2027-03-31 |
| < 4.0 | No |

## What counts

Anything that lets a third party move funds from an app account, run a paid contract action without paying, bypass a guard, or make the streamer process an operation twice. Issues in the built-in contracts count. Issues that require the operator's own private keys do not.

## Hardening guidance for operators

The [Security guide](https://vheissu.github.io/hive-stream/guide/security) covers key handling, payout patterns, randomness and the HTTP API.
