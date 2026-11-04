# HomeFlow Trip v1 · 旅行导入格式

把以下要求交给 ChatGPT：
> 请制定旅行计划，并输出 HomeFlow Trip v1 JSON（参考 schemas/homeflow-trip-v1.schema.json 和 examples/hokkaido-trip-v1.json）。包含每日行程、时间、地点、交通和住宿、待办、行李、预算。未核实的时间价格使用 verification.status='unverified'。保留 importSourceId 与所有 externalId，以便今后更新并保留完成状态。

导入路径：HomeFlow → 计划 → 旅行计划 → 粘贴 JSON → 预览 → 选择已有旅行或创建新旅行 → 确认。

重要：JSON 格式校验由 Worker 的 validatedTripPayload 进行；该 schema 提供基本结构约束，Worker 额外验证日期、重复条目和枚举。未预订的活动必须保持 not_booked。