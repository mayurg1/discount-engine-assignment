import test from 'node:test'
import assert from 'node:assert/strict'
import { AI_RULE_EXAMPLES, selectAiRuleExample } from '../src/components/aiRuleExamples.js'

const expectedExamples = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

test('AI rule examples populate the editable instruction text without parsing', () => {
  assert.deepEqual(AI_RULE_EXAMPLES, expectedExamples)

  for (const example of AI_RULE_EXAMPLES) {
    const populatedText = selectAiRuleExample(example)
    assert.equal(populatedText, example)
    assert.equal(`${populatedText} with an edit`, `${example} with an edit`)
  }
})
