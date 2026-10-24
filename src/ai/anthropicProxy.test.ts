import { describe, it, expect } from 'vitest'
import { buildClaudeSettings } from './configure.js'
import {
  buildAnthropicMessage,
  buildOpenAIRequest,
  buildResponsesChatRequest,
  buildResponsesResponse,
  createResponsesStreamTranslator,
  buildSystemPrompt,
  createStreamTranslator,
  extractApiKey,
  flattenAnthropicText,
  mapStopReason,
  modelAlias,
  modelDescription,
  resolveModel,
  responsesInputToMessages,
  responsesToolsToChat,
  toOpenAIMessages,
  toOpenAITools,
} from './anthropicProxy.js'

describe('anthropic request translation', () => {
  it('joins system blocks and drops cache_control', () => {
    expect(
      buildSystemPrompt([
        { type: 'text', text: 'first', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'second' },
      ])
    ).toBe('first\n\nsecond')
    expect(buildSystemPrompt('plain')).toBe('plain')
    expect(buildSystemPrompt(undefined)).toBeNull()
  })

  it('flattens text and tool_result content', () => {
    expect(
      flattenAnthropicText([
        { type: 'text', text: 'hello' },
        { type: 'tool_result', content: [{ type: 'text', text: 'output' }] },
      ])
    ).toBe('hello\noutput')
  })

  it('maps assistant tool_use blocks to OpenAI tool_calls', () => {
    const messages = toOpenAIMessages(
      [{ type: 'text', text: 'sys' }],
      [
        { role: 'user', content: [{ type: 'text', text: 'read the file' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'sure' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: '/a.txt' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'hi' }] },
          ],
        },
      ]
    )

    expect(messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(messages[1]).toEqual({ role: 'user', content: 'read the file' })
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: 'sure',
      tool_calls: [
        {
          id: 'toolu_1',
          type: 'function',
          function: { name: 'Read', arguments: '{"path":"/a.txt"}' },
        },
      ],
    })
    expect(messages[3]).toEqual({ role: 'tool', content: 'hi', tool_call_id: 'toolu_1' })
  })

  it('emits image parts as image_url for the user turn', () => {
    const messages = toOpenAIMessages(undefined, [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
          },
        ],
      },
    ])
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })

  it('converts Anthropic tools to OpenAI function tools', () => {
    expect(
      toOpenAITools([
        { name: 'Read', description: 'read a file', input_schema: { type: 'object' } },
      ])
    ).toEqual([
      {
        type: 'function',
        function: { name: 'Read', description: 'read a file', parameters: { type: 'object' } },
      },
    ])
    expect(toOpenAITools(undefined)).toBeUndefined()
  })

  it('builds a full OpenAI request and keeps tools', () => {
    const request = buildOpenAIRequest(
      {
        model: 'claude-sonnet-5-5',
        system: [{ type: 'text', text: 'be terse' }],
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 128,
        temperature: 0.2,
        tools: [{ name: 'Read', input_schema: { type: 'object' } }],
        stream: true,
        thinking: { type: 'adaptive' },
        context_management: { edits: [] },
        output_config: { effort: 'high' },
      },
      'xiaomi/mimo-v2.6-flash'
    )

    expect(request).toEqual({
      model: 'xiaomi/mimo-v2.6-flash',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
      max_tokens: 128,
      temperature: 0.2,
      tools: [
        {
          type: 'function',
          function: { name: 'Read', parameters: { type: 'object' } },
        },
      ],
      reasoning: { effort: 'high' },
    })
  })

  it('carries Anthropic reasoning controls as reasoning.effort', () => {
    const effortFrom = (body: Record<string, unknown>) =>
      buildOpenAIRequest(body, 'm').reasoning?.effort

    // Claude Code's own scheme: adaptive thinking plus an explicit effort.
    expect(effortFrom({ output_config: { effort: 'max' } })).toBe('max')
    expect(effortFrom({ output_config: { effort: 'LOW' } })).toBe('low')

    // Turning thinking off must reach the backend as "none", not be dropped.
    expect(effortFrom({ thinking: { type: 'disabled' } })).toBe('none')

    // A fixed token budget is bucketed onto the coarse effort ladder.
    expect(effortFrom({ thinking: { type: 'enabled', budget_tokens: 1024 } })).toBe('low')
    expect(effortFrom({ thinking: { type: 'enabled', budget_tokens: 4096 } })).toBe('medium')
    expect(effortFrom({ thinking: { type: 'enabled', budget_tokens: 16384 } })).toBe('high')
    expect(effortFrom({ thinking: { type: 'enabled', budget_tokens: 32768 } })).toBe('max')

    // Explicit effort wins over the implied default.
    expect(
      effortFrom({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } })
    ).toBe('high')

    // No reasoning controls at all: nothing is sent.
    expect(effortFrom({})).toBeUndefined()
  })

  it('maps stop reasons', () => {
    expect(mapStopReason('tool_calls')).toBe('tool_use')
    expect(mapStopReason('length')).toBe('max_tokens')
    expect(mapStopReason('stop')).toBe('end_turn')
    expect(mapStopReason(undefined)).toBe('end_turn')
  })

  it('reports tool_use even when the backend normalises finish_reason to stop', () => {
    const message = buildAnthropicMessage('msg_1', 'm', {
      choices: [
        {
          message: {
            tool_calls: [{ id: 'c1', function: { name: 'Read', arguments: '{}' } }],
          },
          finish_reason: 'stop',
        },
      ],
    })
    expect(message.stop_reason).toBe('tool_use')
  })
})

describe('anthropic response translation', () => {
  it('wraps a JSON completion as an Anthropic message', () => {
    const message = buildAnthropicMessage('msg_1', 'm', {
      choices: [
        {
          message: {
            content: 'hello',
            tool_calls: [
              { id: 'call_1', function: { name: 'Read', arguments: '{"p":1}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    })

    expect(message.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'call_1', name: 'Read', input: { p: 1 } },
    ])
    expect(message.stop_reason).toBe('tool_use')
    expect(message.usage).toEqual({ input_tokens: 10, output_tokens: 3 })
  })

  it('always emits at least one text block', () => {
    const message = buildAnthropicMessage('msg_1', 'm', { choices: [{ message: {} }] })
    expect(message.content).toEqual([{ type: 'text', text: '' }])
  })

  it('streams text deltas between block start and stop', () => {
    const translator = createStreamTranslator('msg_1', 'm')
    let out = translator.start()
    out += translator.handleChunk({
      choices: [{ delta: { content: 'He' } }],
    })
    out += translator.handleChunk({
      choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }],
    })
    out += translator.finish()

    expect(out).toContain('event: message_start')
    expect(out).toContain('event: content_block_start')
    expect(out).toContain('"text":"He"')
    expect(out).toContain('"text":"llo"')
    expect(out).toContain('event: content_block_stop')
    expect(out).toContain('"stop_reason":"end_turn"')
    expect(out).toContain('event: message_stop')
  })

  it('streams tool calls as input_json_delta fragments', () => {
    const translator = createStreamTranslator('msg_1', 'm')
    let out = translator.start()
    out += translator.handleChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"pa' } },
            ],
          },
        },
      ],
    })
    out += translator.handleChunk({
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"/a"}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    })
    out += translator.finish()

    expect(out).toContain('"type":"tool_use"')
    expect(out).toContain('"name":"Read"')
    expect(out).toContain('"partial_json":"{\\"pa"')
    expect(out).toContain('"stop_reason":"tool_use"')
  })

  it('streams tool calls as tool_use when finish_reason is stop', () => {
    const translator = createStreamTranslator('msg_1', 'm')
    let out = translator.start()
    out += translator.handleChunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{}' } }],
          },
          finish_reason: 'stop',
        },
      ],
    })
    out += translator.finish()
    expect(out).toContain('"stop_reason":"tool_use"')
  })
})

describe('proxy configuration', () => {
  it('resolves the model from the catalogue, falling back to the default', () => {
    const config = {
      models: [
        { id: 'xiaomi/mimo-v2.6-flash', display_name: 'MiMo', price_tiers: [] },
        { id: 'other/model', display_name: 'Other', price_tiers: [] },
      ],
      default_model: 'xiaomi/mimo-v2.6-flash',
    }
    expect(resolveModel('other/model', config)).toBe('other/model')
    expect(resolveModel('MiMo', config)).toBe('xiaomi/mimo-v2.6-flash')
    expect(resolveModel('claude-sonnet-5-5', config)).toBe('xiaomi/mimo-v2.6-flash')
    expect(resolveModel(undefined, config)).toBe('xiaomi/mimo-v2.6-flash')
  })

  it('builds claude-prefixed aliases so gateway discovery keeps them', () => {
    expect(modelAlias('xiaomi/mimo-v2.6-flash')).toBe('paytaca-claude-xiaomi-mimo-v2-6-flash')
    expect(modelAlias('z-ai/glm-5.3')).toBe('paytaca-claude-z-ai-glm-5-3')
    for (const id of ['xiaomi/mimo-v2.6-flash', 'deepseek/deepseek-v4-pro', 'z-ai/glm-5.3']) {
      expect(modelAlias(id)).toMatch(/claude|anthropic/)
    }
  })

  it('captions each model as coming from Paytaca AI', () => {
    expect(modelDescription('xiaomi/mimo-v2.6-flash')).toBe(
      'xiaomi/mimo-v2.6-flash - via Paytaca AI'
    )
  })

  it('maps an alias back to the provider model id', () => {
    const config = {
      models: [
        { id: 'xiaomi/mimo-v2.6-flash', display_name: 'MiMo', price_tiers: [] },
        { id: 'deepseek/deepseek-v4-pro', display_name: 'DeepSeek Pro', price_tiers: [] },
      ],
      default_model: 'xiaomi/mimo-v2.6-flash',
    }
    expect(resolveModel('paytaca-claude-deepseek-deepseek-v4-pro', config)).toBe(
      'deepseek/deepseek-v4-pro'
    )
    expect(resolveModel('paytaca-claude-xiaomi-mimo-v2-6-flash', config)).toBe(
      'xiaomi/mimo-v2.6-flash'
    )
  })

  it('reads the API key from x-api-key or the Bearer header', () => {
    expect(extractApiKey({ 'x-api-key': 'sk-pytc-a' })).toBe('sk-pytc-a')
    expect(extractApiKey({ authorization: 'Bearer sk-pytc-b' })).toBe('sk-pytc-b')
    expect(extractApiKey({})).toBeNull()
  })

  it('points Claude Code at the gateway', () => {
    const settings = buildClaudeSettings(
      {
        models: [{ id: 'm1', display_name: 'M1', price_tiers: [] }],
        default_model: 'm1',
      },
      'http://127.0.0.1:7475',
      'sk-pytc-key'
    )
    expect(settings.model).toBe('paytaca-claude-m1')
    expect(settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:7475',
      ANTHROPIC_AUTH_TOKEN: 'sk-pytc-key',
      ANTHROPIC_MODEL: 'paytaca-claude-m1',
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    })
  })

  it('caps the declared window at the cost-safe context limit', () => {
    const settings = buildClaudeSettings(
      {
        models: [
          { id: 'm1', display_name: 'M1', price_tiers: [], context_input_limit: 1050000 },
        ],
        default_model: 'm1',
      },
      'http://127.0.0.1:7475',
      'sk-pytc-key'
    )
    expect((settings.env as Record<string, string>).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('128000')
  })

  it('uses the cost-safe window when the catalogue does not report one', () => {
    const settings = buildClaudeSettings(
      { models: [{ id: 'm1', display_name: 'M1', price_tiers: [] }], default_model: 'm1' },
      'http://127.0.0.1:7475',
      'sk-pytc-key'
    )
    expect((settings.env as Record<string, string>).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('128000')
  })
})

describe('responses request translation', () => {
  it('maps instructions, messages, calls and outputs to chat messages', () => {
    const messages = responsesInputToMessages(
      [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'be brief' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'read a.txt' }] },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"a.txt"}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'hello' },
      ],
      'system instructions'
    )
    expect(messages).toEqual([
      { role: 'system', content: 'system instructions' },
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'read a.txt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'hello' },
    ])
  })

  it('wraps freeform custom tools as a structured function', () => {
    const { tools, customTools } = responsesToolsToChat([
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
      { type: 'custom', name: 'apply_patch', description: 'Apply a patch', format: {} },
    ])
    expect(customTools).toEqual(new Set(['apply_patch']))
    expect(tools?.[0].function.name).toBe('read_file')
    expect(tools?.[1].function.name).toBe('apply_patch')
    expect(tools?.[1].function.parameters).toMatchObject({
      required: ['input'],
      properties: { input: { type: 'string' } },
    })
  })

  it('flattens namespace tools with a reversible prefix', () => {
    const { tools, namespaces } = responsesToolsToChat([
      {
        type: 'namespace',
        name: 'mcp__paytaca',
        tools: [
          {
            type: 'function',
            name: 'get_image_models',
            description: 'List image models',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ])
    expect(tools?.[0].function.name).toBe('mcp__paytaca__get_image_models')
    expect(namespaces.get('mcp__paytaca__get_image_models')).toEqual({
      namespace: 'mcp__paytaca',
      name: 'get_image_models',
    })
  })

  it('replays namespaced tool calls with the flattened name', () => {
    expect(
      responsesInputToMessages([
        {
          type: 'function_call',
          name: 'get_image_models',
          namespace: 'mcp__paytaca',
          call_id: 'call_1',
          arguments: '{}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      ])
    ).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'mcp__paytaca__get_image_models', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    ])
  })

  it('forwards reasoning effort and limits to the backend request', () => {
    const { request } = buildResponsesChatRequest(
      {
        model: 'glm',
        instructions: 'sys',
        input: [{ type: 'message', role: 'user', content: 'hi' }],
        stream: true,
        max_output_tokens: 4096,
        reasoning: { effort: 'max' },
      },
      'z-ai/glm-5.3'
    )
    expect(request).toMatchObject({
      model: 'z-ai/glm-5.3',
      stream: true,
      max_tokens: 4096,
      reasoning: { effort: 'max' },
    })
  })
})

describe('responses streaming translation', () => {
  it('emits message and completed events for text', () => {
    const translator = createResponsesStreamTranslator('resp_1', 'glm')
    let stream = translator.start()
    stream += translator.handleChunk({
      choices: [{ delta: { content: 'hello' } }],
    })
    stream += translator.handleChunk({
      choices: [{ delta: {} }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
        completion_tokens_details: { reasoning_tokens: 1 },
      },
    })
    stream += translator.finish()

    expect(stream).toContain('event: response.created')
    expect(stream).toContain('event: response.output_item.added')
    expect(stream).toContain('event: response.output_text.delta')
    expect(stream).toContain('"delta":"hello"')
    expect(stream).toContain('event: response.output_item.done')
    expect(stream).toContain('event: response.completed')
    expect(stream).toContain('"input_tokens":3')
    expect(stream).toContain('"output_tokens":2')
    expect(stream).toContain('"reasoning_tokens":1')
    expect(stream).toContain('"total_tokens":5')
  })

  it('emits a custom tool call for freeform tools', () => {
    const translator = createResponsesStreamTranslator(
      'resp_2',
      'glm',
      new Set(['apply_patch'])
    )
    let stream = translator.start()
    stream += translator.handleChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_2',
                function: { name: 'apply_patch', arguments: '{"input":"*** Begin Patch"}' },
              },
            ],
          },
        },
      ],
    })
    stream += translator.finish()
    expect(stream).toContain('"type":"custom_tool_call"')
    expect(stream).toContain('"call_id":"call_2"')
    expect(stream).toContain('"input":"*** Begin Patch"')
    expect(stream).toContain('event: response.completed')
  })
  it('restores the namespace when emitting a namespaced tool call', () => {
    const { namespaces } = responsesToolsToChat([
      { type: 'namespace', name: 'mcp__paytaca', tools: [{ type: 'function', name: 'get_image_models' }] },
    ])
    const translator = createResponsesStreamTranslator(
      'resp_4',
      'glm',
      new Set(),
      namespaces
    )
    let stream = translator.start()
    stream += translator.handleChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_4',
                function: { name: 'mcp__paytaca__get_image_models', arguments: '{}' },
              },
            ],
          },
        },
      ],
    })
    stream += translator.finish()
    expect(stream).toContain('"name":"get_image_models"')
    expect(stream).toContain('"namespace":"mcp__paytaca"')
    expect(stream).not.toContain('mcp__paytaca__get_image_models')
  })
})

describe('responses non-streaming translation', () => {
  it('maps chat completions to a response object', () => {
    const response = buildResponsesResponse('resp_3', 'glm', {
      choices: [
        {
          message: {
            content: 'done',
            tool_calls: [
              { id: 'call_3', function: { name: 'read_file', arguments: '{"path":"a"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }) as any
    expect(response.object).toBe('response')
    expect(response.status).toBe('completed')
    expect(response.output[0].content[0].text).toBe('done')
    expect(response.output[1]).toMatchObject({
      type: 'function_call',
      call_id: 'call_3',
      name: 'read_file',
      arguments: '{"path":"a"}',
    })
    expect(response.usage).toMatchObject({
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
    })
  })

  it('restores the namespace on non-streaming namespaced tool calls', () => {
    const { namespaces } = responsesToolsToChat([
      { type: 'namespace', name: 'mcp__paytaca', tools: [{ type: 'function', name: 'get_image_models' }] },
    ])
    const response = buildResponsesResponse(
      'resp_5',
      'glm',
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_5',
                  function: { name: 'mcp__paytaca__get_image_models', arguments: '{}' },
                },
              ],
            },
          },
        ],
      },
      new Set(),
      namespaces
    ) as any
    expect(response.output[1]).toMatchObject({
      type: 'function_call',
      call_id: 'call_5',
      name: 'get_image_models',
      namespace: 'mcp__paytaca',
    })
  })
})
