const {
  extractConstraintDelta,
  mergeConstraintState,
  detectRequestType,
} = require("./travelAdvisorService");

async function extractIntent(prompt, previousState = {}, entityState = {}, now = new Date()) {
  const delta = extractConstraintDelta(prompt, previousState, now);
  const constraintState = mergeConstraintState(previousState, delta);
  return {
    ...delta,
    requestType: detectRequestType(prompt, entityState, delta),
    constraintState,
  };
}

module.exports = { extractIntent };
