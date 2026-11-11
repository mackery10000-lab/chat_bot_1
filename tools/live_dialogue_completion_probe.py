"""Opt-in provider diagnostics for an otherwise unchanged stress batch.

Only fixed status labels, exception class names and numeric token usage are
recorded. Credentials, headers, prompts and provider error messages stay private.
Uses the same temporary gameplay and explicit call cap as the normal runner.
"""

from types import SimpleNamespace
from unittest.mock import patch

from services import generator
from tools.live_dialogue_stress_cases import run_elder_cleaner


def run_suite(runner):
    original_client = generator.OpenAI

    class TracedClient:
        def __init__(self, *args, **kwargs):
            self.client = original_client(*args, **kwargs)
            self.responses = SimpleNamespace(create=self.create)

        def __enter__(self):
            self.client.__enter__()
            return self

        def __exit__(self, *args):
            return self.client.__exit__(*args)

        def create(self, *args, **kwargs):
            record = runner.report["model_calls"][-1]
            try:
                response = self.client.responses.create(*args, **kwargs)
            except Exception as error:
                record["provider_error_type"] = type(error).__name__
                status = getattr(error, "status_code", None)
                if isinstance(status, int):
                    record["provider_http_status"] = status
                raise
            status = getattr(response, "status", None)
            if status in {"completed", "incomplete", "failed", "cancelled", "queued", "in_progress"}:
                record["provider_completion_status"] = status
            reason = getattr(getattr(response, "incomplete_details", None), "reason", None)
            if reason in {"max_output_tokens", "content_filter"}:
                record["provider_incomplete_reason"] = reason
            usage = getattr(response, "usage", None)
            record["provider_token_usage"] = {
                key: value for key in ("input_tokens", "output_tokens", "total_tokens")
                if isinstance(value := getattr(usage, key, None), int)
            }
            return response

    with patch.object(generator, "OpenAI", TracedClient):
        run_elder_cleaner(runner)
