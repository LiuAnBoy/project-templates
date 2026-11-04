from core.paging import MAX_PAGE_SIZE, page_params


def test_page_size_is_clamped_to_the_maximum_and_reported_as_effective() -> None:
    page = page_params(page=3, page_size=10_000)

    assert page.page_size == MAX_PAGE_SIZE
    assert page.offset == 2 * MAX_PAGE_SIZE
