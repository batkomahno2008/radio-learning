const common = {
  paths: ['tests/features/**/*.feature'],
  require: ['tests/support/**/*.js', 'tests/steps/**/*.js'],
  format: ['progress', 'html:reports/cucumber.html'],
};

module.exports = {
  // Deterministic suite: fake station feed, throwaway database.
  default: { ...common, tags: 'not @wip and not @live' },
  // Scenarios that need the real station to be on air.
  live: { ...common, tags: '@live and not @wip' },
};
