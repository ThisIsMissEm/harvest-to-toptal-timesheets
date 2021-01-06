# Harvest to Toptal Timesheets

A small utility to grab data from Harvest time tracking to create csv files for upload to Toptal Timesheets

## Usage

You'll need to create a personal access token generated at: https://id.getharvest.com/developers

1. Clone this repository
2. `yarn install`
3. `yarn start` (each time you want to fetch a timesheet)

On first run it'll ask for configuration values, if you ever want to change them, run `yarn start --configure`

## Output

The output uses the "rounded hours" that harvest internally uses when generating it's invoices, this ensures that the invoices generated in Harvest from your hours match the hours submitted to toptal for invoicing, such that the amount you're paid should match the invoice you generate.
