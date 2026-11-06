# Checks the sync artifact's data/project-meta.json before the publish job of sync-projects.yml copies it anywhere.
# It mirrors the entry schema in src/lib/projectMeta.ts and adds length caps, because the artifact comes from a job that
# ran the repository's code; src/lib/projectMetaValidation.test.ts fails when the two drift apart.
#
# Input: one JSON object. `$slugs`: the project names of src/content/projects, as a JSON array.
# Output: the first problem as a string, or nothing when the file is fine, so with `jq -e` the exit code is 0 for a
# problem and 4 for a clean file.

# Dates follow z.iso.datetime(): `YYYY-MM-DDTHH:MM:SS` with optional fractional digits and a literal `Z`, and real values
# (month 1 to 12, a day that exists in that month of the Gregorian calendar, hour up to 23, minute and second up to 59).
# \A and \z, not ^ and $: in jq's regex syntax $ also matches before a final newline, and the schema allows no newline.
# The numbers are read from the digits by hand, so nothing depends on how a jq version parses "08".
def re_date: "\\A(?<y>[0-9]{4})-(?<mo>[0-9]{2})-(?<d>[0-9]{2})T(?<h>[0-9]{2}):(?<mi>[0-9]{2}):(?<s>[0-9]{2})(?:\\.[0-9]+)?Z\\z";
def digits: explode | map(. - 48) | reduce .[] as $d (0; . * 10 + $d);
def leap($y): ($y % 4 == 0 and $y % 100 != 0) or $y % 400 == 0;
def days($y; $m): if $m == 2 then (if leap($y) then 29 else 28 end) elif ($m == 4 or $m == 6 or $m == 9 or $m == 11) then 30 else 31 end;
def iso_utc:
  type == "string"
  and (([capture(re_date)] | .[0]) as $parts
       | $parts != null
         and ($parts | map_values(digits)
              | .mo >= 1 and .mo <= 12 and .d >= 1 and .d <= days(.y; .mo) and .h <= 23 and .mi <= 59 and .s <= 59));

# A description needs a character that String.prototype.trim() keeps, which is what z.string().trim().min(1) checks. The
# list is JavaScript's WhiteSpace and LineTerminator set. It is spelled out because a regex class such as \S differs from
# it (U+FEFF is blank to JavaScript only, U+0085 to the regex engine only).
def js_space: [9, 10, 11, 12, 13, 32, 160, 5760, (range(8192; 8203)), 8232, 8233, 8239, 8287, 12288, 65279];
def has_text: type == "string" and (explode | any(.[]; IN(js_space[]) | not));

def fields: ["created", "updated", "description", "tech", "capturedSha"];
def required: ["created", "updated", "description", "tech"];
def entry($k):
  if type != "object" then "\($k): the entry is not an object"
  else
    . as $e
    | first(
        (keys_unsorted[] | select(IN(fields[]) | not) | "\($k): unexpected key '\(.)'"),
        (required[] | select(. as $f | $e | has($f) | not) | "\($k): missing '\(.)'"),
        (("created", "updated") as $f | $e[$f] | select(iso_utc | not) | "\($k): '\($f)' is not an ISO UTC datetime"),
        ($e.description | select((type == "string" and length <= 500 and has_text) | not) | "\($k): 'description' must be a string with visible text, of at most 500 characters"),
        ($e.tech | select((type == "array" and length >= 1 and length <= 20 and all(.[]; type == "string" and length >= 1 and length <= 40)) | not) | "\($k): 'tech' must be 1 to 20 strings of 1 to 40 characters each"),
        (select($e | has("capturedSha")) | $e.capturedSha | select((type == "string" and test("\\A[0-9a-f]{40}\\z")) | not) | "\($k): 'capturedSha' must be 40 lowercase hex characters")
      )
  end;
. as $m
| first(
    (keys_unsorted[] | select(IN($slugs[]) | not) | "unknown project key '\(.)' (there is no src/content/projects/\(.).md)"),
    ($slugs[] | select(. as $s | $m | has($s) | not) | "missing project '\(.)'"),
    (keys_unsorted[] as $k | $m[$k] | entry($k))
  )
