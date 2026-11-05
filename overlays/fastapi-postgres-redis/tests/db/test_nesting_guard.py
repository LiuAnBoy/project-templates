import asyncio

import pytest

from db.nesting_guard import NestingGuard

REFUSAL = "called inside a transaction; pass the session down"


def test_a_nested_call_is_refused_before_anything_runs() -> None:
    guard = NestingGuard("store")

    async def run() -> None:
        async with guard.entered():
            with pytest.raises(RuntimeError, match=REFUSAL):
                async with guard.entered():
                    raise AssertionError("the nested body ran")

    asyncio.run(run())


def test_a_task_started_inside_that_runs_after_the_transaction_ended_opens_its_own() -> None:
    guard = NestingGuard("store")

    async def run() -> str:
        async def later() -> str:
            await asyncio.sleep(0.02)
            async with guard.entered():
                return "opened"

        async with guard.entered():
            task = asyncio.create_task(later())
        return await task

    assert asyncio.run(run()) == "opened"


def test_a_task_started_inside_and_running_while_it_is_open_is_refused() -> None:
    guard = NestingGuard("store")

    async def run() -> None:
        async def during() -> None:
            async with guard.entered():
                raise AssertionError("the nested body ran")

        async with guard.entered():
            task = asyncio.create_task(during())
            with pytest.raises(RuntimeError, match=REFUSAL):
                await task

    asyncio.run(run())


def test_siblings_and_other_stores_are_left_alone() -> None:
    first = NestingGuard("first")
    second = NestingGuard("second")

    async def one() -> str:
        async with first.entered():
            await asyncio.sleep(0.01)
            return "one"

    async def across() -> str:
        async with first.entered(), second.entered():
            return "across"

    async def run() -> list[str]:
        return list(await asyncio.gather(one(), one(), across()))

    assert asyncio.run(run()) == ["one", "one", "across"]


def test_the_scope_ends_when_the_transaction_fails() -> None:
    guard = NestingGuard("store")

    async def run() -> str:
        with pytest.raises(ValueError, match="boom"):
            async with guard.entered():
                raise ValueError("boom")
        async with guard.entered():
            return "next"

    assert asyncio.run(run()) == "next"
