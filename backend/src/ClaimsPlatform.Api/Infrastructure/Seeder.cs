using ClaimsPlatform.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace ClaimsPlatform.Api.Infrastructure;

/// <summary>Creates demo personas and a realistic spread of claims so every screen has something to show.</summary>
public static class Seeder
{
    public static async Task SeedAsync(ClaimsDbContext db)
    {
        if (await db.Users.AnyAsync()) return;

        var users = new[]
        {
            new AppUser { Name = "Aisha Rahman",     Email = "aisha@demo.com",  Role = UserRole.Claimant, Market = Market.MY },
            new AppUser { Name = "Wei Lin Tan",      Email = "weilin@demo.com", Role = UserRole.Claimant, Market = Market.SG },
            new AppUser { Name = "Somchai Prasert",  Email = "somchai@demo.com",Role = UserRole.Claimant, Market = Market.TH },
            new AppUser { Name = "Daniel Ho",        Email = "daniel@demo.com", Role = UserRole.Claimant, Market = Market.HK },
            new AppUser { Name = "Priya Sharma",     Email = "priya@demo.com",  Role = UserRole.Officer },
            new AppUser { Name = "Marcus Tan",       Email = "marcus@demo.com", Role = UserRole.Officer },
            new AppUser { Name = "Linh Nguyen",      Email = "linh@demo.com",   Role = UserRole.Officer },
            new AppUser { Name = "Sarah Whitfield",  Email = "sarah@demo.com",  Role = UserRole.Manager },
        };
        db.Users.AddRange(users);
        await db.SaveChangesAsync();

        var claimants = users.Where(u => u.Role == UserRole.Claimant).ToArray();
        var officers = users.Where(u => u.Role == UserRole.Officer).ToArray();
        var rnd = new Random(42);
        var now = DateTime.UtcNow;

        var motor = new[]
        {
            "Rear-ended at a traffic light on the expressway; bumper and boot damaged.",
            "Side-swiped while changing lanes. Driver's door and mirror need replacement.",
            "Hit a pothole during heavy rain, front-left tyre and alloy wheel damaged.",
            "Parked car was struck overnight; hit-and-run, police report filed.",
            "Windscreen cracked by debris on the highway; vision obstructed.",
            "Collision at a roundabout with another vehicle; both cars drivable.",
        };
        var property = new[]
        {
            "Burst pipe in the apartment flooded the living room and damaged flooring.",
            "Storm damaged part of the roof; water leaking into the upstairs bedroom.",
            "Break-in while we were away. Laptop, jewellery and a television were taken.",
            "Kitchen fire from an electrical fault; cabinets and appliances destroyed.",
            "Air-conditioning unit leaked and ruined the ceiling plaster and paintwork.",
            "Lightning surge damaged electronics and the home network equipment.",
        };
        var places = new Dictionary<Market, string[]>
        {
            [Market.SG] = new[] { "PIE, Singapore", "Tampines, Singapore", "Orchard Road, Singapore" },
            [Market.HK] = new[] { "Kwun Tong, Hong Kong", "Tuen Mun Road, Hong Kong", "Mong Kok, Hong Kong" },
            [Market.TH] = new[] { "Sukhumvit, Bangkok", "Chiang Mai Ring Road", "Phuket Town" },
            [Market.MY] = new[] { "Federal Highway, KL", "Bukit Bintang, KL", "Penang Bridge" },
            [Market.ID] = new[] { "Jl. Sudirman, Jakarta", "Bandung city centre", "Seminyak, Bali" },
            [Market.AU] = new[] { "M1 Pacific Motorway, QLD", "Parramatta, NSW", "St Kilda, VIC" },
        };

        // status mix: plenty open (so dashboards are interesting) and some closed
        var plan = new[]
        {
            ClaimStatus.Submitted, ClaimStatus.Submitted, ClaimStatus.Submitted, ClaimStatus.Submitted, ClaimStatus.Submitted,
            ClaimStatus.UnderReview, ClaimStatus.UnderReview, ClaimStatus.UnderReview, ClaimStatus.UnderReview, ClaimStatus.UnderReview, ClaimStatus.UnderReview,
            ClaimStatus.InfoRequested, ClaimStatus.InfoRequested, ClaimStatus.InfoRequested,
            ClaimStatus.Assessed, ClaimStatus.Assessed, ClaimStatus.Assessed, ClaimStatus.Assessed,
            ClaimStatus.Approved, ClaimStatus.Approved, ClaimStatus.Approved,
            ClaimStatus.Settled, ClaimStatus.Settled, ClaimStatus.Settled, ClaimStatus.Settled, ClaimStatus.Settled,
            ClaimStatus.Rejected, ClaimStatus.Rejected, ClaimStatus.Rejected,
            ClaimStatus.Withdrawn,
        };

        var seq = 0;
        foreach (var target in plan)
        {
            seq++;
            var type = rnd.Next(100) < 55 ? ClaimType.Motor : ClaimType.Property;
            var market = (Market)rnd.Next(0, 6);
            var claimant = claimants[rnd.Next(claimants.Length)];
            var officer = officers[rnd.Next(officers.Length)];
            var daysAgo = rnd.Next(2, 45);
            var created = now.AddDays(-daysAgo).AddHours(-rnd.Next(0, 12));
            var claimed = type == ClaimType.Motor
                ? Math.Round((decimal)(rnd.Next(8, 120) * 100), 0)
                : Math.Round((decimal)(rnd.Next(20, 900) * 100), 0);
            if (seq % 9 == 0) claimed = 85_000 + rnd.Next(0, 6) * 5_000; // a few high-value ones to exercise the four-eyes rule

            var claim = new Claim
            {
                ClaimNumber = $"CLM-{now.Year}-{seq:D6}",
                Type = type,
                Market = market,
                Status = ClaimStatus.Submitted,
                PolicyNumber = $"{(type == ClaimType.Motor ? "MTR" : "PRP")}-{market}-{rnd.Next(100000, 999999)}",
                IncidentDate = created.Date.AddDays(-rnd.Next(1, 5)),
                Location = places[market][rnd.Next(3)],
                Description = (type == ClaimType.Motor ? motor : property)[rnd.Next(6)],
                ClaimedAmount = claimed,
                ClaimantId = claimant.Id,
                CreatedAt = created,
                UpdatedAt = created,
            };

            var t = created;
            void Step(ClaimStatus to, string action, AppUser actor, string? comment = null)
            {
                t = t.AddHours(rnd.Next(3, 30));
                if (t > now) t = now.AddMinutes(-rnd.Next(5, 90));
                claim.History.Add(new ClaimHistory
                {
                    FromStatus = claim.Status,
                    ToStatus = to, Action = action, Comment = comment,
                    ActorId = actor.Id, ActorName = actor.Name, At = t
                });
                claim.Status = to;
                claim.UpdatedAt = t;
            }

            // first history row = the submission itself
            claim.History.Add(new ClaimHistory
            {
                FromStatus = null, ToStatus = ClaimStatus.Submitted, Action = "Claim submitted",
                ActorId = claimant.Id, ActorName = claimant.Name, At = created
            });

            if (target == ClaimStatus.Withdrawn)
            {
                Step(ClaimStatus.Withdrawn, "Withdrawn by claimant", claimant, "Resolved the issue privately.");
                claim.DecidedAt = t;
            }
            else if (target != ClaimStatus.Submitted)
            {
                claim.AssignedOfficerId = officer.Id;
                Step(ClaimStatus.UnderReview, "Picked up for review", officer);

                if (target == ClaimStatus.InfoRequested)
                {
                    claim.InfoRequests.Add(new InfoRequest
                    {
                        Message = "Please upload the police report and two photos of the damage.",
                        RequestedById = officer.Id, RequestedByName = officer.Name, RequestedAt = t.AddHours(1)
                    });
                    Step(ClaimStatus.InfoRequested, "Information requested", officer, "Please upload the police report and two photos of the damage.");
                }
                else if (target == ClaimStatus.Rejected)
                {
                    claim.DecisionReason = "Loss is not covered under the policy terms (pre-existing damage).";
                    Step(ClaimStatus.Rejected, "Claim rejected", officer, claim.DecisionReason);
                    claim.DecidedAt = t;
                }
                else if (target is ClaimStatus.Assessed or ClaimStatus.Approved or ClaimStatus.Settled)
                {
                    claim.AssessedAmount = Math.Round(claim.ClaimedAmount * 0.9m, 0);
                    Step(ClaimStatus.Assessed, "Assessed", officer, $"Assessed at {claim.AssessedAmount:N0}");
                    if (target is ClaimStatus.Approved or ClaimStatus.Settled)
                    {
                        // approvals above the threshold are signed off by the manager
                        var approver = claim.AssessedAmount > ClaimStateMachine.ManagerApprovalThreshold ? users.Last() : officer;
                        claim.ApprovedAmount = claim.AssessedAmount;
                        Step(ClaimStatus.Approved, "Claim approved", approver, $"Approved for {claim.ApprovedAmount:N0}");
                        claim.DecidedAt = t;
                        if (target == ClaimStatus.Settled)
                            Step(ClaimStatus.Settled, "Payment settled", approver);
                    }
                }
            }

            db.Claims.Add(claim);
        }

       await db.SaveChangesAsync();

// Added after the claims are saved: the note's FK must point at a row that already exists.
var noteTarget = await db.Claims.FirstOrDefaultAsync(c => c.AssignedOfficerId != null && c.Status == ClaimStatus.UnderReview);
if (noteTarget is not null)
{
    var author = officers.First(o => o.Id == noteTarget.AssignedOfficerId);
    db.ClaimNotes.Add(new ClaimNote { ClaimId = noteTarget.Id, Text = "Customer called twice - prioritise.", AuthorId = author.Id, AuthorName = author.Name, At = now.AddHours(-5) });
    await db.SaveChangesAsync();
}

        await ExposureProjector.RecomputeAllAsync(db, CancellationToken.None);
    }
}
