# Checks the sync artifact's data/project-meta.json before the publish job of sync-projects.yml copies it anywhere.
# It mirrors the entry schema in src/lib/projectMeta.ts and adds length caps, because the artifact comes from a job that
# ran the repository's code; src/lib/projectMetaValidation.test.ts fails when the two drift apart.
#
# Input: one JSON object. `$slugs`: the project names of src/content/projects, as a JSON array.
# Output: the first problem as a string, or nothing when the file is fine, so with `jq -e` the exit code is 0 for a
# problem and 4 for a clean file.
#
# \A and \z, not ^ and $: in jq's regex syntax $ also matches before a final newline, and the schema allows no newline.
def re_date: "\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z\\z";
def fields: ["created", "updated", "description", "tech", "capturedSha"];
def required: ["created", "updated", "description", "tech"];
def entry($k):
  if type != "object" then "\($k): the entry is not an object"
  else
    . as $e
    | first(
        (keys_unsorted[] | select(IN(fields[]) | not) | "\($k): unexpected key '\(.)'"),
        (required[] | select(. as $f | $e | has($f) | not) | "\($k): missing '\(.)'"),
        (("created", "updated") as $f | $e[$f] | select((type == "string" and test(re_date)) | not) | "\($k): '\($f)' is not an ISO UTC datetime"),
        ($e.description | select((type == "string" and test("\\S") and length <= 500) | not) | "\($k): 'description' must be a string with visible text, of at most 500 characters"),
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
