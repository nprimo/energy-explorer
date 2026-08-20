# User flow

First time a user land on the page it should be able to use the application
locally. This means:

- an anonymous user gets created (based on the IP or Mac address of the machine
  - to be investigated what's feasible and what makes sense)
- the data gets stored in the indexDB using something like [sqlite3 wasm](https://sqlite.org/wasm/doc/trunk/index.md)

What the experience should feel like:

1. user lands on a page where it should be able to define the followings:

- CPE for the readings
- `aat` cookie value

Both values should be stored in a local user table (similar to the one that will
be used for "premium" users).
`aat` value should be encrypted to avoid leaking personal data stored inside
this token.

2. User should be able to visualize which data are available locally (were
   previously pulled)
3. User should be able to pull data from more days AND days that have not all
   data present yet

## Future

More features will be developed in the future. To be defined what can be or not
be done.
