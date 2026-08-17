# TODOs and Ideas

Dump possible next todos and ideas to improve the page

- improve graph ideas
  - make it kWh
  - make the hours easier to read
  - make it easy to change day / have one graph per day in a grid?
  - make it possible to visualize several days consumption overlapped?
    - for example weekly consumption trends each month/season
  - use tanstack charts - 1 dependency less data to pull in / ship to client

- migrate / use effect-ts

- start fetching other data and extract useful information
  - compare my tariff vs indexed price vs mono/bi/tri prices
  - add CO2 emissions for consumption
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
