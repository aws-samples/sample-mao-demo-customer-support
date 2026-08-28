"""Unit tests for gateway.extract_tool_result (MCP tool result normalization)."""

from gateway import extract_tool_result


def test_structured_content_preferred():
    result = {
        "status": "success",
        "toolUseId": "x",
        "content": [{"text": "ignored"}],
        "structuredContent": {"resultSet": {"rows": 3}},
    }
    assert extract_tool_result(result) == {"resultSet": {"rows": 3}}


def test_json_content_item():
    result = {"status": "success", "content": [{"json": {"resultSet": {"rows": 1}}}]}
    assert extract_tool_result(result) == {"resultSet": {"rows": 1}}


def test_text_content_parsed_as_json():
    result = {"status": "success", "content": [{"text": '{"resultSet": {"rows": 2}}'}]}
    assert extract_tool_result(result) == {"resultSet": {"rows": 2}}


def test_plain_text_wrapped():
    result = {"status": "success", "content": [{"text": "hello"}]}
    assert extract_tool_result(result) == {"result": "hello"}


def test_error_status_surfaced():
    result = {"status": "error", "content": [{"text": "table not found"}]}
    out = extract_tool_result(result)
    assert "error" in out and "table not found" in out["error"]


def test_is_error_flag_surfaced():
    result = {"content": [{"text": "boom"}], "isError": True}
    out = extract_tool_result(result)
    assert out["error"].startswith("tool_error:")


def test_non_dict_returns_error():
    assert "error" in extract_tool_result(None)
