const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");
const prompts = require("prompts");
const Harvest = require("harvest").default;
const dotenv = require("dotenv");

function pad(number) {
  if (number < 10) {
    return "0" + number;
  }
  return number;
}

function toDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

function getTimesheetPeriods() {
  const date = new Date();
  const year = date.getFullYear();

  if (date.getDate() > 15) {
    return [
      {
        start: new Date(year, date.getMonth(), 1),
        end: new Date(year, date.getMonth(), 15),
      },
      {
        start: new Date(year, date.getMonth(), 16),
        end: new Date(year, date.getMonth() + 1, 0),
      },
    ];
  } else {
    return [
      {
        start: new Date(year, date.getMonth() - 1, 16),
        end: new Date(year, date.getMonth(), 0),
      },
      {
        start: new Date(year, date.getMonth(), 1),
        end: new Date(year, date.getMonth(), 15),
      },
      {
        start: new Date(year, date.getMonth(), 16),
        end: new Date(year, date.getMonth() + 1, 0),
      },
    ];
  }
}

function timesheetPeriodChoices() {
  const periods = getTimesheetPeriods();

  return periods.map((period) => ({
    title: `${Intl.DateTimeFormat("en-US", { month: "long" }).format(
      period.start
    )} ${period.start.getDate()} to ${period.end.getDate()}`,
    value: period,
  }));
}

async function main() {
  // Try parsing the .env file, in order to get initial configuration values
  // It's a bit goopy because dotenv won't load values already loaded, so you
  // can't "reload" a .env file.
  let hasConfig = false;
  let parsed = {};
  try {
    parsed = dotenv.parse(
      fs.readFileSync(path.resolve(process.cwd(), ".env")),
      { encoding: "utf8" }
    );
    hasConfig =
      parsed.ACCESS_TOKEN &&
      parsed.ACCOUNT_ID &&
      parsed.SUBDOMAIN &&
      parsed.OUTPUT_FOLDER;
  } catch (err) {
    console.error(err);
  }

  if (!hasConfig || process.argv.includes("--configure")) {
    process.stdout.write(
      `Welcome, make sure you've generated a personal access token over at: https://id.getharvest.com/developers\n\n`
    );

    const responses = await prompts(
      [
        {
          type: "text",
          name: "SUBDOMAIN",
          initial: parsed.SUBDOMAIN,
          message: "What is your harvest subdomain?",
        },
        {
          type: "text",
          name: "ACCOUNT_ID",
          initial: parsed.ACCOUNT_ID,
          message: "What is your account ID?",
        },
        {
          type: "text",
          name: "ACCESS_TOKEN",
          initial: parsed.ACCESS_TOKEN,
          message: "What is your personal access token?",
        },
        {
          type: "text",
          name: "OUTPUT_FOLDER",
          initial: path.join(process.env.HOME, "Downloads"),
          message: "Where should we save the CSV files to?",
        },
      ],
      {
        onCancel: () => {
          process.exit(0);
        },
      }
    );

    const envFile = fs
      .readFileSync("./.env.example", { encoding: "utf-8" })
      .split("\n")
      .map((line) =>
        line.replace(/^([A-Z_]+)\=.*$/, (_, name) => {
          if (responses[name]) {
            return `${name}=${JSON.stringify(responses[name])}`;
          }

          return "";
        })
      )
      .filter((line) => !!line)
      .join("\n");

    fs.writeFileSync("./.env", envFile, { encoding: "utf-8" });
  }

  dotenv.config();

  const harvest = new Harvest({
    subdomain: process.env.SUBDOMAIN,
    userAgent: `${pkg.name} v${pkg.version}`,
    concurrency: 1,
    auth: {
      accessToken: process.env.ACCESS_TOKEN,
      accountId: process.env.ACCOUNT_ID,
    },
  });

  const { period } = await prompts({
    name: "period",
    type: "select",
    message: "Fetch time for which period?",
    choices: timesheetPeriodChoices(),
  });

  const clients = (await harvest.clients.list({ is_active: true })).clients;

  const { client } = await prompts({
    type: "select",
    name: "client",
    message: "Please select which client to download data for:",
    choices: clients
      .map((client) => ({
        title: client.name,
        value: client.id,
      }))
      // Reversing because for me the client I usually want is last in my list
      .reverse(),
  });

  const entries = await harvest.timeEntries.list({
    client_id: client,
    from: toDateString(period.start),
    to: toDateString(period.end),
  });

  if (entries.total_pages > 1) {
    console.error("This tool doesn't handle more than 100 time entries");
    process.exit(1);
  }

  const rows = Array.from(
    entries.time_entries
      .reduce((rows, entry) => {
        const prevEntry = rows.get(entry.spent_date);
        if (prevEntry) {
          rows.set(entry.spent_date, {
            date: entry.spent_date,
            hours: prevEntry.hours + entry.rounded_hours,
            notes: prevEntry.notes.includes(entry.task.name)
              ? prevEntry.notes
              : [prevEntry.notes, entry.task.name.replace(" / ", " & ")].join(
                  "; "
                ),
          });
        } else {
          rows.set(entry.spent_date, {
            date: entry.spent_date,
            hours: entry.rounded_hours,
            notes: entry.task.name.replace(" / ", " & "),
          });
        }
        return rows;
      }, new Map())
      .values()
  );

  console.log("\nHours:");
  rows.forEach((row) =>
    console.log(`  ${row.date}\t${row.hours}\t${row.notes}`)
  );

  console.log(
    "\nTotal",
    Array.from(rows).reduce((total, { hours }) => (total += hours), 0)
  );

  const outputFile = path.join(
    process.env.OUTPUT_FOLDER,
    `timesheet-${client}-${toDateString(period.end)}.csv`
  );

  fs.writeFileSync(
    outputFile,
    rows.reduce((csv, row) => {
      csv += "\n";
      csv += `${row.date},${row.hours},${JSON.stringify(row.notes)}`;
      return csv;
    }, `Date,Hours,Notes`),
    { encoding: "utf-8" }
  );

  console.log(`\nCSV written to ${outputFile}\n`);
}

main().catch((err) => console.error(err));
