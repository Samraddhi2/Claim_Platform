using ClaimsPlatform.Api.Application;
using ClaimsPlatform.Api.Domain;
using Xunit;

namespace ClaimsPlatform.Tests;

/// <summary>Entities, enums, exceptions and request/response shapes - the vocabulary every other layer relies on.</summary>
public class DomainModelTests
{
    // ───────────── enums are a contract with the SPA (it keeps string unions with the same names) ─────────────

    [Fact]
    public void ClaimStatus_names_and_order_match_the_frontend_union()
    {
        Assert.Equal(
            new[] { "Submitted", "UnderReview", "InfoRequested", "Assessed", "Approved", "Rejected", "Settled", "Withdrawn" },
            Enum.GetNames<ClaimStatus>());
    }

    [Fact]
    public void ClaimStatus_numeric_values_are_stable()
    {
        for (var i = 0; i < 8; i++) Assert.Equal(i, (int)Enum.GetValues<ClaimStatus>()[i]);
    }

    [Fact]
    public void Markets_are_the_six_APAC_markets()
    {
        Assert.Equal(new[] { "SG", "HK", "TH", "MY", "ID", "AU" }, Enum.GetNames<Market>());
    }

    [Fact]
    public void Claim_types_and_roles_match_the_frontend()
    {
        Assert.Equal(new[] { "Motor", "Property" }, Enum.GetNames<ClaimType>());
        Assert.Equal(new[] { "Claimant", "Officer", "Manager" }, Enum.GetNames<UserRole>());
    }

    // ───────────── Claim ─────────────

    [Fact]
    public void A_new_claim_starts_Submitted_with_empty_collections()
    {
        var c = new Claim();
        Assert.Equal(ClaimStatus.Submitted, c.Status);
        Assert.Empty(c.History);
        Assert.Empty(c.InfoRequests);
        Assert.Empty(c.Notes);
        Assert.Equal(0, c.Version);
        Assert.Equal("", c.ClaimNumber);
        Assert.Null(c.AssessedAmount);
        Assert.Null(c.ApprovedAmount);
        Assert.Null(c.AssignedOfficerId);
        Assert.Null(c.DecidedAt);
    }

    [Fact]
    public void Collections_are_not_shared_between_claims()
    {
        var a = new Claim();
        var b = new Claim();
        a.History.Add(new ClaimHistory());
        Assert.Empty(b.History);
    }

    [Theory]
    [InlineData(1000, null, null, 1000)]
    [InlineData(1000, 800, null, 800)]
    [InlineData(1000, 800, 750, 750)]
    [InlineData(1000, null, 750, 750)]
    public void Exposure_is_approved_then_assessed_then_claimed(int claimed, int? assessed, int? approved, int expected)
    {
        var c = new Claim
        {
            ClaimedAmount = claimed,
            AssessedAmount = assessed,
            ApprovedAmount = approved,
        };
        Assert.Equal((decimal)expected, c.ExposureAmount);
    }

    [Fact]
    public void Exposure_keeps_cents()
    {
        var c = new Claim { ClaimedAmount = 1234.56m };
        Assert.Equal(1234.56m, c.ExposureAmount);
    }

    // ───────────── DomainException ─────────────

    [Fact]
    public void DomainException_defaults_to_400()
    {
        var ex = new DomainException("bad input");
        Assert.Equal(400, ex.StatusCode);
        Assert.Equal("bad input", ex.Message);
    }

    [Theory]
    [InlineData(403)]
    [InlineData(404)]
    [InlineData(409)]
    public void DomainException_carries_its_http_status(int status)
    {
        Assert.Equal(status, new DomainException("x", status).StatusCode);
    }

    [Fact]
    public void DomainException_is_a_normal_exception()
    {
        Exception ex = new DomainException("x");
        Assert.IsType<DomainException>(ex);
    }

    // ───────────── other entities ─────────────

    [Fact]
    public void Notifications_start_unread()
    {
        Assert.False(new Notification().IsRead);
    }

    [Fact]
    public void Outbox_messages_start_undispatched()
    {
        var m = new OutboxMessage();
        Assert.Null(m.DispatchedAt);
        Assert.Equal("", m.Payload);
    }

    [Fact]
    public void Info_requests_start_unanswered()
    {
        var r = new InfoRequest();
        Assert.Null(r.Response);
        Assert.Null(r.RespondedAt);
    }

    [Fact]
    public void History_rows_may_have_no_previous_status_for_the_initial_submission()
    {
        Assert.Null(new ClaimHistory().FromStatus);
    }

    [Fact]
    public void Staff_users_may_have_no_home_market()
    {
        Assert.Null(new AppUser { Role = UserRole.Officer }.Market);
    }

    // ───────────── request / response shapes ─────────────

    [Fact]
    public void A_list_query_defaults_to_page_one_of_ten()
    {
        var q = new ClaimQuery();
        Assert.Equal(1, q.Page);
        Assert.Equal(10, q.PageSize);
        Assert.Null(q.Status);
        Assert.Null(q.Search);
        Assert.Null(q.Unassigned);
        Assert.Null(q.OpenOnly);
    }

    [Fact]
    public void Requests_are_value_objects()
    {
        Assert.Equal(new AssignRequest(5), new AssignRequest(5));
        Assert.NotEqual(new AssignRequest(5), new AssignRequest(6));
        Assert.Null(new AssignRequest(null).OfficerId);
        Assert.Equal("a@b.c", new LoginRequest("a@b.c").Email);
    }

    [Fact]
    public void Approve_and_assess_requests_make_the_comment_and_amount_optional_where_documented()
    {
        Assert.Null(new ApproveRequest(null, null).ApprovedAmount);
        Assert.Null(new AssessRequest(100m, null).Comment);
    }

    [Fact]
    public void Paged_results_carry_the_paging_info()
    {
        var page = new PagedResult<int>(new List<int> { 1, 2 }, 25, 3, 10);
        Assert.Equal(2, page.Items.Count);
        Assert.Equal(25, page.Total);
        Assert.Equal(3, page.Page);
        Assert.Equal(10, page.PageSize);
    }

    [Fact]
    public void Create_claim_request_keeps_every_field()
    {
        var date = new DateTime(2026, 10, 1);
        var r = new CreateClaimRequest(ClaimType.Property, Market.HK, "PRP-1", date, "Kwun Tong", "Burst pipe", 2500m);
        Assert.Equal(ClaimType.Property, r.Type);
        Assert.Equal(Market.HK, r.Market);
        Assert.Equal("PRP-1", r.PolicyNumber);
        Assert.Equal(date, r.IncidentDate);
        Assert.Equal("Kwun Tong", r.Location);
        Assert.Equal("Burst pipe", r.Description);
        Assert.Equal(2500m, r.ClaimedAmount);
    }
}
