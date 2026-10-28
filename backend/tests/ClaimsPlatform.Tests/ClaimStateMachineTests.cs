using ClaimsPlatform.Api.Domain;
using Xunit;

namespace ClaimsPlatform.Tests;

public class ClaimStateMachineTests
{
    [Theory]
    [InlineData(ClaimStatus.Submitted, ClaimStatus.UnderReview)]
    [InlineData(ClaimStatus.UnderReview, ClaimStatus.InfoRequested)]
    [InlineData(ClaimStatus.InfoRequested, ClaimStatus.UnderReview)]
    [InlineData(ClaimStatus.UnderReview, ClaimStatus.Assessed)]
    [InlineData(ClaimStatus.Assessed, ClaimStatus.Approved)]
    [InlineData(ClaimStatus.Approved, ClaimStatus.Settled)]
    [InlineData(ClaimStatus.Assessed, ClaimStatus.Rejected)]
    public void Valid_transitions_are_allowed(ClaimStatus from, ClaimStatus to) =>
        Assert.True(ClaimStateMachine.CanTransition(from, to));

    [Theory]
    [InlineData(ClaimStatus.Submitted, ClaimStatus.Approved)]
    [InlineData(ClaimStatus.Submitted, ClaimStatus.Settled)]
    [InlineData(ClaimStatus.UnderReview, ClaimStatus.Settled)]
    [InlineData(ClaimStatus.Rejected, ClaimStatus.Approved)]
    [InlineData(ClaimStatus.Settled, ClaimStatus.UnderReview)]
    [InlineData(ClaimStatus.Withdrawn, ClaimStatus.UnderReview)]
    [InlineData(ClaimStatus.Approved, ClaimStatus.Rejected)]
    public void Invalid_transitions_are_blocked(ClaimStatus from, ClaimStatus to)
    {
        Assert.False(ClaimStateMachine.CanTransition(from, to));
        var ex = Assert.Throws<DomainException>(() => ClaimStateMachine.EnsureTransition(from, to));
        Assert.Equal(409, ex.StatusCode);
    }

    [Theory]
    [InlineData(ClaimStatus.Rejected)]
    [InlineData(ClaimStatus.Settled)]
    [InlineData(ClaimStatus.Withdrawn)]
    public void Terminal_states_are_not_open(ClaimStatus s) => Assert.False(ClaimStateMachine.IsOpen(s));

    [Fact]
    public void Exposure_prefers_approved_then_assessed_then_claimed()
    {
        var c = new Claim { ClaimedAmount = 1000 };
        Assert.Equal(1000, c.ExposureAmount);
        c.AssessedAmount = 800;
        Assert.Equal(800, c.ExposureAmount);
        c.ApprovedAmount = 750;
        Assert.Equal(750, c.ExposureAmount);
    }

    [Fact]
    public void Only_assignee_or_manager_can_work_a_claim()
    {
        var claim = new Claim { Id = 1, Status = ClaimStatus.UnderReview, AssignedOfficerId = 10 };
        var assignee = new AppUser { Id = 10, Role = UserRole.Officer };
        var other = new AppUser { Id = 11, Role = UserRole.Officer };
        var manager = new AppUser { Id = 99, Role = UserRole.Manager };

        Assert.Contains("assess", ClaimStateMachine.AvailableActions(claim, assignee));
        Assert.DoesNotContain("assess", ClaimStateMachine.AvailableActions(claim, other));
        Assert.Contains("assess", ClaimStateMachine.AvailableActions(claim, manager));
    }

    [Fact]
    public void Claimant_can_only_respond_when_info_requested()
    {
        var owner = new AppUser { Id = 1, Role = UserRole.Claimant };
        var claim = new Claim { ClaimantId = 1, Status = ClaimStatus.UnderReview };
        Assert.DoesNotContain("provideInfo", ClaimStateMachine.AvailableActions(claim, owner));
        claim.Status = ClaimStatus.InfoRequested;
        Assert.Contains("provideInfo", ClaimStateMachine.AvailableActions(claim, owner));
    }
}
