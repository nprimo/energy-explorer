# TODOs and Ideas

Dump possible next todos and ideas to improve the page

## Ideas and possible todos

- improve graph ideas
  - make it kWh
  - make the hours easier to read
  - make it easy to change day / have one graph per day in a grid?
  - make it possible to visualize several days consumption overlapped?
    - for example weekly consumption trends each month/season
  - use tanstack charts - 1 dependency less data to pull in / ship to client
  - use GitHub overview - lines might not be the best to see longer periods.
    Use colors + transparency to show higher consumptions, higher prices or
    higher CO2 emissions (for example)

- start fetching other data and extract useful information
  - compare my tariff vs indexed price vs mono,bi,tri prices
  - add CO2 emissions for consumption - for example using electricity map
  - ...

- make it "client" side first -> paid user stored in D1 / remote DB be able to,
  for example, check for neighbours consumption curves, energy communities,
  flexible assets etc

- improve update of token
  - it should be like:
    - token expired -> redirect to login page from eredes
    - once logged in -> pull token and save it somewhere locally to be used
      in the app later on -> redirect to main application

- Add a cron job to pull all the electricity price available from ERSE
  - use `./docs/erse-periodic-pull.md` plan

- Have a "pull" page and a "view" page
  - `pull` page is supposed to show data available (last 30 days default, for
    example) and select which data to pull
    - eventually focus on estimated vs real consumption

- Have a look if it's possible to get some extra information from the CPE code.
  For example: is it possible to understand if 2 CPE are linked to the same LV
  grid by their values? If so, it might "ease" to assess collective
  self-consumption and similar initiatives.

- Better handle DB migrations
  - remove all the JS code - make the migrations "stand alone". Run it once and
    separately from application.

- effect schema E-Redes
  - is the optional things required?
  - can i just try to "unmarshall" the JSON into the struct I'm expecting. If
    that's not possible, return an error (invalid shape), instead of using
    `uknownEffect` + all the functions to transform things?

- project or WorkOS - https://workos.com/docs/authkit
- explore minimum effort to get authentication + invite only
